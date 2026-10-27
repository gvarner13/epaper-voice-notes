import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listRecordings, readTranscript } from "../src/lib/cloud.server";

const id = (char: string) => "recorder-1_" + char.repeat(32);
const token = "synthetic-reader-token-" + "x".repeat(32);
const origin = "https://notes.example.test";
const note = (char = "a", uploaded = "2026-10-10T12:00:00Z") => ({
  id: id(char),
  filename: "VN000001.WAV",
  captured_at: null,
  uploaded_at: uploaded,
  duration_seconds: 60,
  state: "ready",
  attempts: 1,
  sha256: "private checksum not needed in browser",
});
const canonical = (text: string) =>
  `---\nrecording_id: ${id("a")}\n---\n\n# ${id("a")}\n\n${text}\n`;
const json = (data: unknown) => new Response(JSON.stringify(data));

beforeEach(() => {
  vi.stubEnv("VOICE_NOTES_URL", origin);
  vi.stubEnv("VOICE_NOTES_READER_TOKEN", token);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("read-only cloud adapter", () => {
  it("follows every cursor, sorts by upload not random ID, and sends credentials only upstream", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({
          notes: [note("a", "2026-10-11T12:00:00Z")],
          cursor: id("a"),
          usage: { seconds: 30 },
        }),
      )
      .mockResolvedValueOnce(
        json({ notes: [note("b", "2026-10-12T12:00:00Z")], cursor: null }),
      );
    const result = await listRecordings();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.value.map((item) => item.id)).toEqual([id("b"), id("a")]);
    expect(result.value[0]).not.toHaveProperty("sha256");
    expect(JSON.stringify(result)).not.toContain(token);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      origin + "/recordings?after=" + id("a"),
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: expect.objectContaining({ Authorization: "Bearer " + token }),
      }),
    );
  });
  it("orders timestamps chronologically even when fractional precision differs", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({
        notes: [
          note("a", "2026-10-10T12:00:00Z"),
          note("b", "2026-10-10T12:00:00.500Z"),
        ],
        cursor: null,
      }),
    );
    const result = await listRecordings();
    expect(result.ok && result.value.map((item) => item.id)).toEqual([
      id("b"),
      id("a"),
    ]);
  });
  it("handles an empty archive", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ notes: [], cursor: null }));
    expect(await listRecordings()).toEqual({ ok: true, value: [] });
  });
  it("returns the exact canonical Markdown separately from clean copy text", async () => {
    const markdown = canonical("A thought.\n\nAnother thought.").replace(
      /\n/g,
      "\r\n",
    );
    vi.mocked(fetch).mockResolvedValue(new Response(markdown));
    expect(await readTranscript(id("a"))).toEqual({
      ok: true,
      value: { text: "A thought.\n\nAnother thought.", markdown },
    });
  });
  it("rejects invalid IDs before contacting the service", async () => {
    expect((await readTranscript("../token")).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 429, 500, 302])(
    "handles HTTP %s without leaking response contents or following redirects",
    async (status) => {
      vi.mocked(fetch).mockResolvedValue(
        new Response("private upstream details " + token, { status }),
      );
      const result = await readTranscript(id("a"));
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(result)).not.toContain("private upstream");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("hides transport exception details", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error(token));
    expect(JSON.stringify(await listRecordings())).not.toContain(token);
  });
  it("explains missing configuration without fetching", async () => {
    vi.stubEnv("VOICE_NOTES_READER_TOKEN", "");
    const result = await listRecordings();
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("not configured"),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "http://notes.test",
    "https://user:secret@notes.test",
    "https://notes.test/path",
    "https://notes.test?token=secret",
    "https://notes.test/#fragment",
    "not a url",
  ])("rejects unsafe origin %s", async (url) => {
    vi.stubEnv("VOICE_NOTES_URL", url);
    expect((await listRecordings()).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves validated classification metadata while stripping internal job fields", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ notes: [{ ...note(),
      classification_status: "complete", classification: "task",
      classification_model: "@cf/cloudflare/clef",
      classification_probabilities: { note: 0.1, task: 0.9 },
      classification_input_tokens: 123, classification_attempts: 1,
      classification_attempt_id: "internal-job-token", classification_lease_until: 1234,
    }] }));
    const result = await listRecordings();
    expect(result).toMatchObject({ ok: true, value: [{
      classification_status: "complete", classification: "task",
      classification_model: "@cf/cloudflare/clef",
      classification_probabilities: { note: 0.1, task: 0.9 },
      classification_input_tokens: 123, classification_attempts: 1,
    }] });
    expect(JSON.stringify(result)).not.toContain("internal-job-token");
    expect(JSON.stringify(result)).not.toContain("classification_lease_until");
  });
  it.each([
    { classification: "other" },
    { classification_status: "unknown" },
    { classification_status: "complete" },
    { classification_probabilities: { note: -0.1, task: 1.1 } },
    { classification_input_tokens: -1 },
  ])("rejects malformed classification metadata: %j", async classification => {
    vi.mocked(fetch).mockResolvedValue(json({ notes: [{ ...note(), ...classification }] }));
    expect((await listRecordings()).ok).toBe(false);
  });
  it("fails safely on malformed metadata", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({ notes: [{ ...note(), state: "invented" }] }),
    );
    expect((await listRecordings()).ok).toBe(false);
  });
  it("rejects invalid, repeated, or backwards cursors", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({ notes: [note()], cursor: "../secret" }),
    );
    expect((await listRecordings()).ok).toBe(false);
    vi.mocked(fetch).mockImplementation(async () =>
      json({ notes: [note()], cursor: id("a") }),
    );
    expect(await listRecordings()).toMatchObject({
      ok: false,
      error: expect.stringContaining("cursor"),
    });
  });
  it("limits streamed responses instead of buffering arbitrarily", async () => {
    let cancelled = false;
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    expect(await readTranscript(id("a"))).toMatchObject({
      ok: false,
      error: expect.stringContaining("too large"),
    });
    expect(cancelled).toBe(true);
  });
  it("never publishes mismatched Markdown as a transcript", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("---\nid: wrong\n---\n\n# wrong\n\nHello"),
    );
    expect((await readTranscript(id("a"))).ok).toBe(false);
  });
});
