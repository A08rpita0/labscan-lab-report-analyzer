import type { ApiError } from "../../api/client";
import type { InputRef } from "../../App";
import { bytes, num } from "../../lib/format";
import { Icon } from "../ui";

/* Every failure answers three questions: what happened, what the reader can do next,
 * and (behind "Technical details") what was processed. A refused document (not a lab
 * report, unreadable scan) is not a crash - the engine's own verdict says what it
 * looked for and what it found. */

const NEXT_STEPS: Record<string, string[]> = {
  not_a_report: [
    "Upload a pathology or diagnostic report that lists test names with their results.",
    "If this is a lab report, export it as CSV or JSON from the source system and try that.",
  ],
  unreadable: [
    "Scanned or photographed reports have no text layer. Download the digital PDF from the laboratory portal instead.",
    "Alternatively export the results as CSV or JSON.",
  ],
  corrupt_pdf: ["Re-download or re-export the PDF, then upload it again."],
  invalid_json: ["Validate the JSON (the message names the position), or re-export it."],
  empty_file: ["Check that the export finished writing, then choose the file again."],
  file_too_large: ["Export only the results pages, or use the CSV/JSON export, which is far smaller."],
  unsupported_type: ["Accepted formats are PDF (with selectable text), CSV, TSV, TXT and JSON."],
  network_error: ["Check your connection and try again. A sleeping free-tier server can take ~30 s to wake."],
  client_timeout: ["Try again in a moment; if the file is a large PDF, try a CSV or JSON export."],
  analysis_timeout: ["Try a CSV or JSON export of the same results, which is read much faster."],
};

export function ErrorState({ error, input, onRetry, onDismiss, onExamples }: {
  error: ApiError;
  input?: InputRef;
  onRetry?: () => void;
  onDismiss: () => void;
  /** Recovery path for someone without a usable file: try one of the examples. */
  onExamples?: () => void;
}) {
  const doc = error.body?.document;
  const signals = (doc?.signals ?? {}) as Record<string, number | boolean | string[]>;
  const refused = error.code === "not_a_report" || error.code === "unreadable";
  const name = input ? (input.kind === "file" ? input.file.name : input.sample.file) : null;
  const size = input ? (input.kind === "file" ? input.file.size : input.sample.size_bytes) : null;
  const steps = NEXT_STEPS[error.code] ?? (error.hint ? [] : ["Try again. If the problem persists, report the request id below."]);
  const transient = ["network_error", "client_timeout", "analysis_timeout", "internal_error", "http_502", "http_503"].includes(error.code);

  return (
    <div className="error-state panel fade-in" role="alert">
      <div className="error-head">
        <span className={`error-icon${refused ? " is-refused" : ""}`}>
          <Icon name={refused ? "file" : "alert"} />
        </span>
        <div>
          <span className={`badge ${refused ? "" : "badge-amber"}`}>{refused ? "Not analysed" : "Analysis failed"}</span>
          <h2>{error.message}</h2>
          {(doc?.guidance ?? error.hint) && <p className="muted">{doc?.guidance ?? error.hint}</p>}
        </div>
      </div>

      <div className="error-body">
        <h3 className="error-sub">What you can do</h3>
        <ul className="error-steps small">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        {doc?.accepted_formats && doc.accepted_formats.length > 0 && (
          <>
            <h3 className="error-sub">Files we can read</h3>
            <ul className="error-formats small muted">
              {doc.accepted_formats.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="error-actions">
        {transient && onRetry && (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <Icon name="refresh" /> Try again
          </button>
        )}
        <button type="button" className={`btn${transient && onRetry ? "" : " btn-primary"}`} onClick={onDismiss}>
          <Icon name="upload" /> Choose another file
        </button>
        {onExamples && (
          <button type="button" className="btn btn-ghost" onClick={onExamples}>
            Try an example instead
          </button>
        )}
      </div>

      <details className="error-more">
        <summary>Technical details</summary>
        <div className="error-grid">
          <div>
            <h3 className="error-sub">What happened</h3>
            <p className="small">
              {refused
                ? "We read the file but did not find a laboratory report in it, so nothing was analysed. Showing empty results would wrongly suggest everything was normal."
                : error.status
                  ? `The service answered with status ${error.status} (${error.code}).`
                  : "The request did not complete."}
            </p>
          </div>
          <div>
            <h3 className="error-sub">What was processed</h3>
            {doc ? (
              <dl className="kv">
                {name && (<><dt>File</dt><dd className="mono">{name}</dd></>)}
                <dt>Characters read</dt>
                <dd className="num">{num(signals.text_characters as number)}</dd>
                <dt>Results found</dt>
                <dd className="num">{num(signals.observations_extracted as number)}</dd>
                <dt>Tests we recognised</dt>
                <dd className="num">{num(signals.parameters_recognised as number)}</dd>
                <dt>With a unit or normal range</dt>
                <dd className="num">{num(signals.parameters_with_unit_or_range as number)}</dd>
              </dl>
            ) : (
              <p className="small">
                {name ? (
                  <>
                    <span className="mono">{name}</span>
                    {size !== null && ` (${bytes(size)})`}:{" "}
                  </>
                ) : null}
                {error.status ? "no results were produced and nothing was kept." : "the file may not have reached the server."}
              </p>
            )}
            {error.requestId && <p className="xs muted error-rid">Request id <span className="mono">{error.requestId}</span></p>}
          </div>
        </div>
      </details>
    </div>
  );
}
