import { api, type ApiError } from "../../api/client";
import type { Sample } from "../../api/types";
import { bytes } from "../../lib/format";
import { EXERCISE_WORD, word } from "../../lib/labels";

/* The bundled samples are synthetic records built to exercise specific parts of the
 * pipeline. Each card describes the INPUT - format, structure, what it exercises - and
 * never an expected result: running it is the only way to see what the engine finds. */
export function SampleGallery({ samples, error, onRetry, busy, onRun }: {
  samples: Sample[] | null;
  error: ApiError | null;
  onRetry: () => void;
  busy: boolean;
  onRun: (s: Sample) => void;
}) {
  if (error) {
    return (
      <div className="callout callout-warn" role="alert">
        <span className="sr-only">Error</span>
        <div>
          <b>The samples could not be loaded.</b> {error.message} {error.hint}{" "}
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (samples === null) {
    return (
      <div className="sample-grid" aria-busy="true" aria-label="Loading samples">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="sample-card skeleton" style={{ height: 196 }} />
        ))}
      </div>
    );
  }
  if (!samples.length) {
    return <p className="muted small">No samples are installed on this server. Upload a report above to analyse it.</p>;
  }
  return (
    <ul className="sample-grid" role="list">
      {samples.map((s) => (
        <li key={s.file} className="sample-card">
          <div className="sample-top">
            <h3 className="sample-title">{s.title}</h3>
            <span className={`format format-${s.format.toLowerCase()}`}>{s.format}</span>
          </div>
          <details className="sample-about">
            <summary>About this example</summary>
            <p className="sample-desc">{s.description}</p>
            {s.scenario && (
              <p className="sample-scenario xs">
                <span className="muted">Built to show:</span> {s.scenario}
              </p>
            )}
            <ul className="sample-tags" aria-label="What this example tests in the engine">
              {s.exercises.map((x) => (
                <li key={x}>{word(EXERCISE_WORD, x)}</li>
              ))}
            </ul>
            <p className="sample-file xs muted">
              <span className="mono">{s.file}</span>, {bytes(s.size_bytes)}.{" "}
              <a href={api.sampleInputUrl(s.file)} target="_blank" rel="noopener">
                Open the file
              </a>
            </p>
          </details>
          <div className="sample-actions">
            <button type="button" className="btn btn-accent" disabled={busy} onClick={() => onRun(s)}>
              Try this example
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
