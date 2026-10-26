import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/client/", import.meta.url));
const forbidden = [
  "VOICE_NOTES_READER_TOKEN",
  "VOICE_NOTES_URL",
  "VoiceNotesLocalReader/1.0",
  "Reader not configured.",
  "Authorization",
  "cloud.server",
];
for (const entry of await readdir(root, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile() || !/\.(js|map|html)$/.test(entry.name)) continue;
  const text = await readFile(
    new URL(entry.name, "file://" + entry.parentPath + "/"),
    "utf8",
  );
  for (const marker of forbidden) {
    if (text.includes(marker))
      throw new Error(`Server-only marker found in client bundle: ${marker}`);
  }
}
console.log(
  "Client bundle contains no reader configuration or cloud credential code.",
);
