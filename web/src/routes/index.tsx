import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  LockKeyhole,
  RefreshCw,
  Radio,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getRecordings, getTranscript } from "@/lib/recordings.functions";
import {
  RECORDING_ID,
  classificationLabel,
  formatDate,
  formatDuration,
  recordingDate,
  states,
  type Recording,
  type Result,
  type Transcript,
} from "@/lib/recordings";

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { recording?: string } => ({
    recording:
      typeof search.recording === "string" &&
      RECORDING_ID.test(search.recording)
        ? search.recording
        : undefined,
  }),
  loader: () => getRecordings(),
  component: Archive,
});

function Waveform({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 220 56"
      fill="none"
      aria-hidden="true"
    >
      {[
        9, 17, 11, 29, 21, 44, 27, 18, 36, 54, 31, 23, 42, 16, 25, 37, 20, 12,
        27, 15, 8, 14, 6,
      ].map((height, index) => (
        <path
          key={index}
          d={`M${index * 9.5 + 5} ${28 - height / 2}v${height}`}
          stroke="currentColor"
          strokeWidth="3"
        />
      ))}
    </svg>
  );
}

function Archive() {
  const result = Route.useLoaderData();
  const { recording: requestedId } = Route.useSearch();
  const notes = result.ok ? result.value : [];
  const selected = requestedId
    ? notes.find((note) => note.id === requestedId)
    : notes[0];
  const readyCount = notes.filter((note) => note.state === "ready").length;
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [revision, setRevision] = useState(0);
  const readerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (requestedId && window.matchMedia("(max-width: 760px)").matches) {
      readerRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [requestedId]);

  function refresh() {
    startRefresh(async () => {
      await router.invalidate();
      setRevision((value) => value + 1);
    });
  }

  return (
    <div className="site-shell" data-reading={Boolean(requestedId)}>
      <a className="skip-link" href="#archive">
        Skip to recordings
      </a>
      <header className="site-header">
        <Link
          to="/"
          search={{}}
          className="wordmark"
          aria-label="Voice Notes home"
        >
          <span className="brand-symbol" aria-hidden="true">
            <Radio size={26} strokeWidth={2} />
          </span>
          <span>
            VOICE
            <span className="wordmark-bottom">
              NOTES<span className="brand-period">.</span>
            </span>
          </span>
        </Link>
        <span className="header-caption">
          A PERSONAL RECORD.
          <br />
          NOTHING LOST IN TRANSLATION.
        </span>
        <div className="local-indicator">
          <span className="signal-dot" /> LOCAL READER{" "}
          <LockKeyhole size={12} aria-hidden="true" />
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="archive-title">
          <div>
            <p className="eyebrow">
              <span className="small-cross" aria-hidden="true">
                ＋
              </span>{" "}
              THE PERSONAL ARCHIVE / VOL. 01
            </p>
            <h1 id="archive-title">
              OFF THE MIND.
              <br />
              <span>ON THE RECORD.</span>
            </h1>
          </div>
          <div className="hero-aside">
            <span className="hero-stamp" aria-hidden="true">
              VN<span>↗</span>
            </span>
            <p>
              Passing thoughts.
              <br />A permanent place.
            </p>
            <div className="hero-wave">
              <Waveform />
              <span>CAPTURE. TRANSCRIBE. KEEP.</span>
            </div>
          </div>
        </section>

        <section
          className="archive-section"
          id="archive"
          aria-label="Recording archive"
          tabIndex={-1}
        >
          <div className="archive-toolbar">
            <div className="archive-label">
              <span className="red-square" /> THE ARCHIVE{" "}
              <span className="archive-total">
                {String(notes.length).padStart(2, "0")}
              </span>
            </div>
            <div className="archive-toolbar-right">
              <span className="sort-label">
                LATEST UPLOAD FIRST <ArrowDown size={12} aria-hidden="true" />
              </span>
              <Button
                variant="outline"
                size="sm"
                className="refresh-button"
                onClick={refresh}
                disabled={refreshing}
              >
                <RefreshCw
                  size={13}
                  className={refreshing ? "is-spinning" : ""}
                  aria-hidden="true"
                />
                {refreshing ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          </div>
          {!result.ok ? (
            <div className="connection-error" role="alert">
              <TriangleAlert size={28} aria-hidden="true" />
              <p className="eyebrow">CONNECTION INTERRUPTED</p>
              <h2>Let’s get your thoughts back.</h2>
              <p>{result.error}</p>
              <Button onClick={refresh} disabled={refreshing}>
                <RefreshCw size={14} /> Try again
              </Button>
            </div>
          ) : notes.length === 0 ? (
            <div className="empty-archive">
              <Waveform />
              <p className="eyebrow">A LITTLE QUIET IN HERE</p>
              <h2>Your next thought starts here.</h2>
              <p>
                Record a voice note on your device. Once it uploads, it will
                appear in this archive.
              </p>
            </div>
          ) : (
            <div className="workspace" data-detail={Boolean(requestedId)}>
              <aside className="recording-sidebar" aria-label="Recordings">
                <div className="list-heading">
                  <h2>ALL RECORDINGS</h2>
                  <span>
                    {readyCount} READY / {notes.length} TOTAL
                  </span>
                </div>
                <nav className="recording-list" aria-label="Choose a recording">
                  {notes.map((note, index) => (
                    <RecordingRow
                      key={note.id}
                      note={note}
                      index={index}
                      active={selected?.id === note.id}
                    />
                  ))}
                </nav>
                <div className="list-bottom">
                  <LockKeyhole size={12} aria-hidden="true" />
                  <span>PRIVATE THOUGHTS. PRIVATE ARCHIVE.</span>
                </div>
              </aside>
              <div
                className="reader-pane"
                role="region"
                aria-label="Selected recording"
                tabIndex={-1}
                ref={readerRef}
              >
                <h1 className="sr-only mobile-reader-heading">
                  {selected
                    ? `Recording ${selected.filename}`
                    : "Recording not found"}
                </h1>
                <Link to="/" search={{}} className="back-link">
                  <ArrowLeft size={15} aria-hidden="true" /> All recordings
                </Link>
                {selected ? (
                  <TranscriptReader
                    key={selected.id}
                    recording={selected}
                    revision={revision}
                  />
                ) : (
                  <div className="reader-message">
                    <FileText size={30} aria-hidden="true" />
                    <h2>Recording not found.</h2>
                    <p>
                      It may no longer be in the archive. Choose another
                      recording.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <span>
          <span className="footer-cross" aria-hidden="true">
            ＋
          </span>{" "}
          VOICE NOTES — PERSONAL ARCHIVE
        </span>
        <span>
          FAITHFULLY TRANSCRIBED. NEVER REWRITTEN.{" "}
          <ArrowUpRight size={12} aria-hidden="true" />
        </span>
      </footer>
    </div>
  );
}

function RecordingRow({
  note,
  index,
  active,
}: {
  note: Recording;
  index: number;
  active: boolean;
}) {
  const date = recordingDate(note);
  return (
    <Link
      to="/"
      search={{ recording: note.id }}
      resetScroll={false}
      className={`recording-row ${active ? "is-active" : ""}`}
      aria-current={active ? "true" : undefined}
    >
      <span className="recording-number">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="recording-row-content">
        <div className="recording-row-top">
          <span className="recording-date">{formatDate(date.value)}</span>
          <span className="row-arrow" aria-hidden="true">
            ↗
          </span>
        </div>
        <p className="recording-filename">{note.filename}</p>
        <div className="recording-row-bottom">
          <span>
            {date.label.toUpperCase()} · {formatDuration(note.duration_seconds)}
          </span>
          <span className={`row-status status-${note.state}`}>
            <span />
            {states[note.state].label}
          </span>
        </div>
      </div>
    </Link>
  );
}

function TranscriptReader({
  recording,
  revision,
}: {
  recording: Recording;
  revision: number;
}) {
  const [result, setResult] = useState<Result<Transcript> | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copying, startCopy] = useTransition();
  const date = recordingDate(recording);
  const transcript = result?.ok ? result.value : null;

  useEffect(() => {
    let current = true;
    setResult(null);
    setCopyStatus("");
    if (recording.state === "ready") {
      getTranscript({ data: recording.id })
        .then((value) => {
          if (current) setResult(value);
        })
        .catch(() => {
          if (current)
            setResult({
              ok: false,
              error: "Could not load this transcript. Please try again.",
            });
        });
    }
    return () => {
      current = false;
    };
  }, [recording.id, recording.state, revision, attempt]);

  function copy() {
    if (!transcript) return;
    startCopy(async () => {
      try {
        await navigator.clipboard.writeText(transcript.text);
        setCopyStatus("Transcript copied.");
      } catch {
        setCopyStatus(
          "Clipboard unavailable. Select the transcript text to copy it manually.",
        );
      }
    });
  }

  function download() {
    if (!transcript) return;
    const url = URL.createObjectURL(
      new Blob([transcript.markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${recording.id}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return (
    <article className="transcript-reader">
      <div className="reader-topline">
        <span className="eyebrow">
          <FileText size={12} aria-hidden="true" /> RECORDING /{" "}
          {recording.filename.replace(".WAV", "")}
        </span>
        <Badge
          variant="outline"
          className={`state-badge status-${recording.state}`}
        >
          <span className="badge-dot" />
          {states[recording.state].label}
        </Badge>
      </div>
      <div className="reader-title-row">
        <h2>{formatDate(date.value)}</h2>
        <span className="reader-duration">
          <Clock3 size={14} aria-hidden="true" />
          {formatDuration(recording.duration_seconds)}
        </span>
      </div>
      <p className="reader-date-label">
        {date.label} at {formatDate(date.value, true)} UTC
        {recording.captured_at ? "" : " · Capture time unknown"}
      </p>
      <div className="reader-actions">
        <span className="transcript-label">
          THE TRANSCRIPT <span aria-hidden="true">↘</span>
        </span>
        <div className="action-buttons">
          <Button
            variant="ghost"
            size="sm"
            onClick={copy}
            disabled={!transcript || copying}
            aria-label="Copy transcript text"
          >
            {copyStatus === "Transcript copied." ? (
              <Check size={14} />
            ) : (
              <Copy size={14} />
            )}
            <span>
              {copyStatus === "Transcript copied." ? "Copied" : "Copy"}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={download}
            disabled={!transcript}
          >
            <ArrowDownToLine size={14} aria-hidden="true" />
            <span>Markdown</span>
          </Button>
        </div>
      </div>
      <p className="copy-feedback" role="status">
        {copyStatus}
      </p>
      <Separator />
      {recording.state !== "ready" ? (
        <div className="reader-message">
          <span className="message-symbol">
            <Radio size={25} aria-hidden="true" />
          </span>
          <h3>
            {states[recording.state].label === "Queued"
              ? "Waiting for its words."
              : `Transcription ${states[recording.state].label.toLowerCase()}.`}
          </h3>
          <p>{states[recording.state].description}</p>
          {recording.error ? (
            <p className="processing-error">{recording.error}</p>
          ) : null}
          <p className="message-footnote">
            This reader never starts or retries processing.
          </p>
        </div>
      ) : !result ? (
        <div
          className="transcript-loading"
          role="status"
          aria-label="Loading transcript"
        >
          <Skeleton className="h-5 w-11/12" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="mt-6 h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
          <span className="sr-only">Loading transcript…</span>
        </div>
      ) : !result.ok ? (
        <div className="reader-message" role="alert">
          <TriangleAlert size={24} aria-hidden="true" />
          <h3>Words temporarily out of reach.</h3>
          <p>{result.error}</p>
          <Button
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Load transcript again
          </Button>
        </div>
      ) : (
        <div className="transcript-content">
          {recording.outcome === "no-speech-model-result" ? (
            <p className="no-speech-notice">
              The model detected no speech. This is a model result, not proof
              that the recording is silent.
            </p>
          ) : null}
          <div className="transcript-text">{result.value.text}</div>
          <div className="transcript-end">
            <span />
            <span>END OF TRANSCRIPT</span>
            <span />
          </div>
        </div>
      )}
      <details className="recording-details">
        <summary>
          RECORDING DETAILS <ChevronDown size={13} aria-hidden="true" />
        </summary>
        <dl>
          <div>
            <dt>Original file</dt>
            <dd>{recording.filename}</dd>
          </div>
          <div>
            <dt>Captured</dt>
            <dd>
              {recording.captured_at
                ? `${formatDate(recording.captured_at, true)} UTC`
                : "Unknown — not inferred from upload time"}
            </dd>
          </div>
          <div>
            <dt>Uploaded</dt>
            <dd>{formatDate(recording.uploaded_at, true)} UTC</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(recording.duration_seconds)}</dd>
          </div>
          <div>
            <dt>Recording ID</dt>
            <dd className="recording-id">{recording.id}</dd>
          </div>
          <div>
            <dt>Processing attempts</dt>
            <dd>{recording.attempts}</dd>
          </div>
          <div>
            <dt>Classification</dt>
            <dd>{classificationLabel(recording)}</dd>
          </div>
          {recording.classification_model ? (
            <div>
              <dt>Classifier</dt>
              <dd>{recording.classification_model}</dd>
            </div>
          ) : null}
          {recording.classification_probabilities ? (
            <div>
              <dt>Model probabilities</dt>
              <dd>
                Note {(recording.classification_probabilities.note * 100).toFixed(1)}%
                {" · "}Task {(recording.classification_probabilities.task * 100).toFixed(1)}%
              </dd>
            </div>
          ) : null}
          {recording.classification_error ? (
            <div>
              <dt>Classification error</dt>
              <dd>{recording.classification_error}</dd>
            </div>
          ) : null}
        </dl>
      </details>
    </article>
  );
}
