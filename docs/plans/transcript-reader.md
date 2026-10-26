# Local transcript reader

## Agreed scope

Build a read-only TanStack Start + shadcn/ui app under `web/`, run only on this computer's loopback interface. Fetch recordings and canonical Markdown from the existing authenticated cloud API through the local server. Keep reader credentials server-side, with no deployment or sign-in.

Translate the Akira reference into warm paper, ink-black typography, motorcycle-red accents, pale blue, condensed display headings, and restrained industrial details. Do not use the reference artwork. Desktop has a recording list beside a transcript; mobile uses list-to-detail navigation.

List all recording states newest-upload-first, with honest capture/upload date labels, original filename, and duration. Keep stable identity in details. Show faithful transcript text separately from metadata. Copy copies transcript text; download saves unchanged canonical Markdown as `<recording-id>.md`. Fetch on opening and manual refresh, without polling.

Exclude editing, summaries, generated titles/tags, audio playback, uploads, processing retries, and changes to the device or transcription pipeline. No automatic modification of downloaded local transcripts. Existing domain language remains in [GLOSSARY.md](../../GLOSSARY.md).

## Implementation and verification

Implemented in [`web/`](../../web/README.md). No firmware or cloud service source changes were needed.

- 44 reader tests cover pagination, chronological ordering, unknown capture dates, processing states, canonical Markdown extraction, malformed data, bounded responses, safe failures, and local-request isolation.
- App build, typechecking, and browser-bundle isolation checks pass. The actual reader credential is absent from app source and client build output.
- Synthetic browser checks passed for desktop/mobile navigation, copy, canonical Markdown download, manual refresh, all processing states, model-reported no speech, empty archives, error recovery, and safe display of HTML-like speech.
- Accessibility audits report zero detected violations for desktop and mobile list/detail views. Some offscreen desktop list rows require manual contrast review; their text colors match the checked visible rows.
- The development server listens only on `127.0.0.1`. Foreign hosts, origins, and cross-site requests are rejected, and Vite denies access to ignored credential files.
- A read-only live check loaded all nine existing recordings and a complete transcript. Browser resource requests stayed on the local origin. No upload, inference, retry, deployment, or cloud mutation was performed.

Existing Cloudflare test tooling pins an older Zod release with an npm audit advisory; that dependency is unchanged by this feature. The reader's direct Zod dependency uses a patched release.
