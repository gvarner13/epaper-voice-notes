export const MODEL = "xai/grok-stt";
export type State = "uploaded" | "running" | "ready" | "failed" | "paused" | "uncertain";
export interface Note {
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
export function markdown(note: Note, text: string) {
  return `---\nrecording_id: ${note.id}\noriginal_filename: ${note.filename}\ncaptured_at: ${note.captured_at ?? "null"}\nuploaded_at: ${note.uploaded_at}\nduration_seconds: ${note.duration_seconds}\noriginal_audio: r2://epaper-voice-notes/audio/${note.id}.wav\nmodel: ${MODEL}\noutcome: ${text.trim() ? "speech" : "no-speech-model-result"}\n---\n\n# ${note.id}\n\n${text.trim() || "No speech detected (model result; not proof of silence)."}\n`;
}
