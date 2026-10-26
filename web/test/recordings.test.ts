import { describe, expect, it, vi } from "vitest";
import {
  formatDate,
  formatDuration,
  recordingDate,
  states,
  transcriptText,
  type Recording,
} from "../src/lib/recordings";
// Exercise the real publisher without adding the Workers runtime types to the browser app.
const { markdown } = await vi.importActual<{
  markdown: (
    note: Recording & { sha256: string; bytes: number },
    text: string,
  ) => string;
}>("../../cloud/worker/src/domain");

const id = "recorder-1_" + "a".repeat(32);
const note: Recording & { sha256: string; bytes: number } = {
  id,
  filename: "VN000001.WAV",
  captured_at: null,
  uploaded_at: "2026-10-10T12:00:00.000Z",
  duration_seconds: 12.5,
  state: "ready",
  attempts: 1,
  sha256: "b".repeat(64),
  bytes: 400044,
};
describe("recording presentation", () => {
  it("never substitutes upload time for capture time", () => {
    expect(recordingDate(note)).toEqual({
      label: "Uploaded",
      value: note.uploaded_at,
    });
    expect(
      recordingDate({ ...note, captured_at: "2026-10-09T12:00:00Z" }),
    ).toEqual({ label: "Captured", value: "2026-10-09T12:00:00Z" });
  });
  it("formats durations without decimal noise", () => {
    expect([0, 12.5, 61, 1800, 3601].map(formatDuration)).toEqual([
      "0:00",
      "0:12",
      "1:01",
      "30:00",
      "60:01",
    ]);
  });
  it("renders dates deterministically in UTC", () => {
    expect(formatDate(note.uploaded_at)).toBe("Oct 10, 2026");
    expect(formatDate(note.uploaded_at, true)).toContain("12:00 PM");
  });
  it("explains every production processing state", () => {
    const all: Recording["state"][] = [
      "uploaded",
      "running",
      "ready",
      "failed",
      "paused",
      "uncertain",
    ];
    for (const state of all)
      expect(states[state].description.length).toBeGreaterThan(10);
  });
});

describe("canonical Markdown", () => {
  it("extracts only the known wrapper without rewriting personal text", () => {
    const text =
      'First paragraph, um, exactly as spoken.\n\n# A heading I dictated\n<script>alert("not executed")</script>\n\n---\nLast thought.';
    const canonical = markdown(note, text);
    expect(transcriptText(canonical, id)).toBe(text);
  });
  it("understands CRLF without changing the downloaded original", () => {
    const canonical = markdown(note, "My thought.").replace(/\n/g, "\r\n");
    expect(transcriptText(canonical, id)).toBe("My thought.");
    expect(canonical).toContain("\r\n");
  });
  it("preserves the no-speech caveat", () => {
    expect(transcriptText(markdown(note, ""), id)).toBe(
      "No speech detected (model result; not proof of silence).",
    );
  });
  it("rejects malformed wrappers or mismatched recording identities", () => {
    expect(() => transcriptText("plain text", id)).toThrow("format");
    expect(() =>
      transcriptText(markdown(note, "Hello"), "recorder-1_" + "b".repeat(32)),
    ).toThrow("identity");
    expect(() => transcriptText(markdown(note, "Hello"), "../secrets")).toThrow(
      "ID",
    );
  });
});
