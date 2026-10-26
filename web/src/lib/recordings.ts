export const RECORDING_ID = /^[a-z0-9-]{1,32}_[a-f0-9]{32}$/;
export type RecordingState =
  "uploaded" | "running" | "ready" | "failed" | "paused" | "uncertain";
export interface Recording {
  id: string;
  filename: string;
  duration_seconds: number;
  captured_at: string | null;
  uploaded_at: string;
  state: RecordingState;
  attempts: number;
  error?: string;
  outcome?: "speech" | "no-speech-model-result";
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Transcript {
  text: string;
  markdown: string;
}

export const states: Record<
  RecordingState,
  { label: string; description: string }
> = {
  uploaded: {
    label: "Queued",
    description: "The recording is uploaded and waiting for transcription.",
  },
  running: {
    label: "Processing",
    description:
      "Transcription is in progress. Only the completed result will appear here.",
  },
  ready: {
    label: "Ready",
    description: "The complete transcript is available.",
  },
  failed: {
    label: "Failed",
    description: "Transcription failed. The original recording is preserved.",
  },
  paused: {
    label: "Paused",
    description: "Processing is paused. The original recording is preserved.",
  },
  uncertain: {
    label: "Uncertain",
    description:
      "The processing attempt ended without a confirmed outcome. It has not been automatically restarted.",
  },
};

export function recordingDate(recording: Recording) {
  return {
    label: recording.captured_at ? "Captured" : "Uploaded",
    value: recording.captured_at ?? recording.uploaded_at,
  };
}

export function formatDate(value: string, includeTime = false) {
  // Explicit locale/timezone keeps server and client rendering identical.
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    ...(includeTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatDuration(seconds: number) {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function transcriptText(markdown: string, id: string) {
  if (!RECORDING_ID.test(id)) throw new Error("Invalid recording ID");
  const normalized = markdown.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (!normalized.startsWith("---\n") || end < 0)
    throw new Error("Invalid transcript format");
  const body = normalized.slice(end + 5).trimStart();
  const heading = `# ${id}\n`;
  if (!body.startsWith(heading)) throw new Error("Invalid transcript identity");
  // Remove only our known wrapper, never interpret the person's words as HTML.
  return body.slice(heading.length).trim();
}
