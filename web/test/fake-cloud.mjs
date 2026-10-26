// Browser-test fixture only. Preload with node --import ./test/fake-cloud.mjs scripts/dev.mjs.
// Never imports into the app or contacts the real transcription service.
import { readFileSync, appendFileSync } from "node:fs";
const origin = "https://voice-notes-fixture.test";
process.env.VOICE_NOTES_URL = origin;
process.env.VOICE_NOTES_READER_TOKEN =
  "synthetic-fixture-reader-token-not-a-real-credential";
const originalFetch = globalThis.fetch;
const modeFile = new URL("../../.local/reader-fixture-mode", import.meta.url);
const requestFile = new URL(
  "../../.local/reader-fixture-requests.jsonl",
  import.meta.url,
);
function mode() {
  try {
    return readFileSync(modeFile, "utf8").trim();
  } catch {
    return "";
  }
}
const makeId = (index) => "recorder-1_" + index.toString(16).padStart(32, "0");
const states = [
  "ready",
  "ready",
  "ready",
  "running",
  "uploaded",
  "paused",
  "failed",
  "uncertain",
];
const notes = states.map((state, index) => ({
  id: makeId(index + 1),
  filename: "VN" + String(81 - index).padStart(6, "0") + ".WAV",
  captured_at:
    index % 2 === 0
      ? `2026-10-${String(20 - index).padStart(2, "0")}T08:34:00Z`
      : null,
  uploaded_at: `2026-10-${String(20 - index).padStart(2, "0")}T08:35:00Z`,
  duration_seconds: index === 0 ? 94.432 : 26 + index * 13,
  state,
  attempts: state === "uploaded" ? 0 : 1,
  outcome:
    index === 2
      ? "no-speech-model-result"
      : state === "ready"
        ? "speech"
        : undefined,
  error: state === "failed" ? "Inference HTTP 400" : undefined,
}));
const text = [
  "I was thinking about how the best ideas always seem to show up when I’m doing something else. Walking home, making coffee, halfway through a conversation. Never when I’m sitting down trying to have one.\n\nMaybe that’s the whole point of this little recorder. Not to make thinking more productive, but to give those passing thoughts somewhere to land. Before they disappear into the rest of the day.\n\nThere’s something nice about just saying it out loud. No opening an app, no deciding where it belongs. Just a thought, captured as it was. I’d like to keep it that simple.",
  "Remember to leave more room between things. An afternoon without a plan is not an afternoon wasted.\n\nThis is a synthetic browser-test transcript.\n<script>window.fixtureScriptExecuted = true</script>",
  "No speech detected (model result; not proof of silence).",
];
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.origin !== origin) return originalFetch(input, init);
  if ((init?.method ?? "GET") !== "GET")
    throw new Error("Fixture permits only read requests");
  appendFileSync(
    requestFile,
    JSON.stringify({ path: url.pathname, method: init?.method ?? "GET" }) +
      "\n",
  );
  const current = mode();
  if (current === "list-error" && url.pathname === "/recordings")
    return new Response("synthetic private failure", { status: 503 });
  if (url.pathname === "/recordings")
    return Response.json({
      notes: current === "empty" ? [] : notes,
      cursor: null,
    });
  const note = notes.find(
    (note) => url.pathname === `/recordings/${note.id}/transcript`,
  );
  if (!note) return new Response("Not found", { status: 404 });
  if (current === "transcript-error")
    return new Response("synthetic failure", { status: 503 });
  const index = notes.indexOf(note);
  return new Response(
    `---\nrecording_id: ${note.id}\noriginal_filename: ${note.filename}\ncaptured_at: ${note.captured_at ?? "null"}\nuploaded_at: ${note.uploaded_at}\nduration_seconds: ${note.duration_seconds}\n---\n\n# ${note.id}\n\n${text[index] ?? ""}\n`,
    { headers: { "content-type": "text/markdown" } },
  );
};
