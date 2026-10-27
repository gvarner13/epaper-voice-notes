export const MODEL = "xai/grok-stt";
export const CLASSIFIER_MODEL = "@cf/cloudflare/clef";
export interface ClassificationResult {
  classification: "note" | "task";
  classification_probabilities: { note: number; task: number };
  classification_input_tokens: number;
}
export interface ClassificationMetadata {
  classification_status?: "pending" | "complete" | "failed" | "not-applicable";
  classification?: "note" | "task";
  classification_model?: string;
  classification_probabilities?: { note: number; task: number };
  classification_input_tokens?: number;
  classification_attempts?: number;
  classification_error?: string;
}

export type State = "uploaded" | "running" | "ready" | "failed" | "paused" | "uncertain";
export interface Note extends ClassificationMetadata {
  id: string;
  filename: string;
  sha256: string;
  bytes: number;
  duration_seconds: number;
  captured_at: string | null;
  uploaded_at: string;
  state: State;
  attempts: number;
  error?: string;
  attempt_id?: string;
  lease_until?: number;
  retry_at?: number;
  outcome?: "speech" | "no-speech-model-result";
  classification_attempt_id?: string;
  classification_lease_until?: number;
  classification_retry_at?: number;
}
export interface Env {
  AI: Ai;
  NOTES: R2Bucket;
  JOBS: Queue<{ id: string }>;
  LEDGER: DurableObjectNamespace<import("./ledger").NotesLedger>;
  DEVICE_ID: string;
  DEVICE_TOKEN: string;
  READER_TOKEN: string;
  AUDIO_SIGNING_KEY: string;
  PUBLIC_ORIGIN: string;
  AI_GATEWAY_ID: string;
  PROCESSING_ENABLED: string;
  MONTHLY_AUDIO_SECONDS: string;
  MAX_ATTEMPTS: string;
  MAX_AUDIO_BYTES: string;
}
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function validId(id: string) { return /^[a-z0-9-]{1,32}_[a-f0-9]{32}$/.test(id); }
export function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export function wavDuration(header: Uint8Array, size: number) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const text = (start: number, length: number) => new TextDecoder().decode(header.slice(start, start + length));
  if (header.length < 44 || text(0, 4) !== "RIFF" || text(8, 8) !== "WAVEfmt " ||
      view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
      view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000 ||
      view.getUint32(28, true) !== 32000 || view.getUint16(32, true) !== 2 ||
      view.getUint16(34, true) !== 16 || text(36, 4) !== "data" ||
      view.getUint32(4, true) + 8 !== size || view.getUint32(40, true) + 44 !== size ||
      size <= 44 || (size - 44) % 2) throw new HttpError(422, "Damaged or unsupported WAV");
  return (size - 44) / 32000;
}
/** Classification is authoritative in the ledger. Project its current snapshot into
 * downloads without rewriting the immutable transcript body or requiring an R2/DO dual write.
 * Historical Markdown without a classification job is returned byte-for-byte.
 */
export function classifiedMarkdown(source: string, note: Note) {
  if (!note.classification_status) return source;
  const fields: Record<string, unknown> = {
    classification_status: note.classification_status,
    classification: note.classification ?? null,
    classification_model: note.classification_model ?? null,
    classification_probabilities: note.classification_probabilities ?? null,
    classification_input_tokens: note.classification_input_tokens ?? null,
    classification_attempts: note.classification_attempts ?? 0,
    classification_error: note.classification_error ?? null,
  };
  const end = source.indexOf("\n---\n", 4);
  if (!source.startsWith("---\n") || end < 0) throw new Error("Invalid stored transcript");
  const metadata = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n");
  return source.slice(0, end) + "\n" + metadata + source.slice(end);
}
export class ProcessingError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
export function transcript(response: unknown): string {
  if (!response || typeof response !== "object") throw new ProcessingError("Invalid model response", false);
  if (!("state" in response) || response.state !== "Completed" || !("result" in response) ||
      !response.result || typeof response.result !== "object" || !("text" in response.result) || typeof response.result.text !== "string")
    throw new ProcessingError("Model did not return a completed transcript", false);
  return response.result.text;
}
export function markdown(note: Note, text: string) {
  return `---\nrecording_id: ${note.id}\noriginal_filename: ${note.filename}\ncaptured_at: ${note.captured_at ?? "null"}\nuploaded_at: ${note.uploaded_at}\nduration_seconds: ${note.duration_seconds}\noriginal_audio: r2://epaper-voice-notes/audio/${note.id}.wav\nmodel: ${MODEL}\noutcome: ${text.trim() ? "speech" : "no-speech-model-result"}\n---\n\n# ${note.id}\n\n${text.trim() || "No speech detected (model result; not proof of silence)."}\n`;
}
