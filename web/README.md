# Local voice-note reader

A read-only TanStack Start + shadcn/ui archive. It runs on this computer and reads the existing cloud API; it does not deploy anything or start transcription.

## Run

Use Node.js 22.13+ (Node 24 recommended). From the repository root:

```sh
npm ci
npm run dev:web
```

Open **http://127.0.0.1:3000**. Stop with Ctrl+C. The port is fixed and the server binds only to loopback; there is no LAN access or sign-in.

This machine's existing ignored `.local/production.env` is loaded automatically. For another setup, copy `web/.env.example` to `web/.env.local` and set the HTTPS Worker origin and separate reader credential. Explicit environment variables take precedence, then `web/.env.local`, then `.local/production.env`. Restart after changing configuration. Never use a `VITE_` prefix or put credentials in source control.

The app needs Internet access to read cloud data. “Local” describes where the site runs, not an offline copy. It does not read or change the downloaded `transcripts/` directory. A browser download follows the browser's normal save/overwrite behavior.

## Behavior

- Desktop: recording list beside the transcript. Mobile: list-to-detail navigation with a back link and browser history.
- Fetch on opening and manual Refresh; no polling, analytics, remote fonts, or third-party browser requests.
- All recordings, newest upload first. Capture time is shown only when known; upload dates are labeled, and all times explicitly use UTC.
- Faithful text, including paragraph breaks, is displayed as text rather than executable HTML. Canonical metadata lives in Recording details and the Markdown download.
- Copy copies only transcript text. Markdown downloads the unchanged canonical file under its stable recording ID.
- Processing, queued, paused, failed, uncertain, and model-reported no-speech states are explicit. Reading never retries processing or triggers paid inference.

No editing, generated titles, summaries, audio playback, uploads, or cloud mutations are implemented. Loopback access is not an authentication boundary against other software or users on the same computer. Do not expose this development server through a proxy or tunnel.

## Checks

```sh
npm run test -w @voice-notes/web
npm run typecheck -w @voice-notes/web
npm run check:bundle -w @voice-notes/web
```

The last command builds and checks the browser output for server-only credential/configuration code. Generated route types in `src/routeTree.gen.ts` are checked in for fresh-checkout typechecking and refreshed by Vite.

For browser testing without private notes, stop the real reader and run from `web/`:

```sh
mkdir -p ../.local
node --import ./test/fake-cloud.mjs scripts/dev.mjs
```

The preload supplies synthetic notes and intercepts only its fake upstream origin. It is never included in the application build. Set `.local/reader-fixture-mode` to `empty`, `list-error`, or `transcript-error`, then Refresh, to exercise failures; an empty file restores normal fixtures. Synthetic request paths are recorded in `.local/reader-fixture-requests.jsonl`.

Agreed scope: [reader plan](../docs/plans/transcript-reader.md). Domain vocabulary: [glossary](../GLOSSARY.md).
