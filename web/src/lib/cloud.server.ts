import { z } from "zod";
import {
  RECORDING_ID,
  transcriptText,
  type Recording,
  type Result,
  type Transcript,
} from "./recordings";

const idSchema = z.string().regex(RECORDING_ID);
const recordingSchema = z.object({
  id: idSchema,
  filename: z.string().regex(/^VN\d{6}\.WAV$/),
  duration_seconds: z.number().finite().nonnegative(),
  captured_at: z.iso.datetime().nullable(),
  uploaded_at: z.iso.datetime(),
  state: z.enum([
    "uploaded",
    "running",
    "ready",
    "failed",
    "paused",
    "uncertain",
  ]),
  attempts: z.number().int().nonnegative(),
  error: z.string().max(500).optional(),
  outcome: z.enum(["speech", "no-speech-model-result"]).optional(),
  classification_status: z.enum(["pending", "complete", "failed", "not-applicable"]).optional(),
  classification: z.enum(["note", "task"]).optional(),
  classification_model: z.string().max(100).optional(),
  classification_probabilities: z.object({
    note: z.number().min(0).max(1),
    task: z.number().min(0).max(1),
  }).optional(),
  classification_input_tokens: z.number().int().nonnegative().optional(),
  classification_attempts: z.number().int().nonnegative().optional(),
  classification_error: z.string().max(500).optional(),
}).refine(recording => recording.classification_status !== "complete" ||
  (recording.classification !== undefined && recording.classification_model !== undefined &&
    recording.classification_probabilities !== undefined));
const pageSchema = z.object({
  notes: z.array(recordingSchema),
  cursor: idSchema.nullable().optional(),
});
const MAX_BYTES = 4 * 1024 * 1024;

class ReaderError extends Error {}

function configuration() {
  const origin = process.env.VOICE_NOTES_URL;
  const token = process.env.VOICE_NOTES_READER_TOKEN;
  if (!origin || !token || token.length < 32)
    throw new ReaderError(
      "Reader not configured. Set VOICE_NOTES_URL and VOICE_NOTES_READER_TOKEN in web/.env.local, then restart the app.",
    );
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ReaderError("VOICE_NOTES_URL must be an HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new ReaderError(
      "VOICE_NOTES_URL must be an HTTPS origin without credentials or a path.",
    );
  return { origin: url.origin, token };
}

async function readBody(response: Response) {
  if (!response.body)
    throw new ReaderError("The transcript service returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES)
        throw new ReaderError("The transcript service response is too large.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function client() {
  const { origin, token } = configuration();
  const signal = AbortSignal.timeout(30_000);
  return async (path: string) => {
    const response = await fetch(origin + path, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "VoiceNotesLocalReader/1.0",
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      const message =
        response.status === 401 || response.status === 403
          ? "Reader access was denied. Check the server-side reader credential and restart the app."
          : response.status === 409
            ? "This transcript is not complete yet. Refresh the recordings to see its current state."
            : response.status === 404
              ? "This recording or transcript could not be found."
              : "The transcript service is unavailable. Please try Refresh.";
      throw new ReaderError(message);
    }
    return readBody(response);
  };
}

async function safely<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ReaderError
          ? error.message
          : "Could not read the transcript service. Check your connection and configuration, then try Refresh.",
    };
  }
}

export function listRecordings(): Promise<Result<Recording[]>> {
  return safely(async () => {
    const request = client();
    const notes = new Map<string, Recording>();
    let after = "";
    do {
      const page = pageSchema.parse(
        JSON.parse(
          await request("/recordings" + (after ? `?after=${after}` : "")),
        ),
      );
      for (const note of page.notes) notes.set(note.id, note);
      if (!page.cursor) break;
      if (page.cursor <= after || notes.size > 100_000)
        throw new ReaderError(
          "The transcript service returned an invalid continuation cursor.",
        );
      after = page.cursor;
    } while (true);
    return [...notes.values()].sort(
      (a, b) =>
        Date.parse(b.uploaded_at) - Date.parse(a.uploaded_at) ||
        a.id.localeCompare(b.id),
    );
  });
}

export function readTranscript(id: string): Promise<Result<Transcript>> {
  return safely(async () => {
    if (!RECORDING_ID.test(id)) throw new ReaderError("Invalid recording ID.");
    const markdown = await client()(`/recordings/${id}/transcript`);
    return { markdown, text: transcriptText(markdown, id) };
  });
}
