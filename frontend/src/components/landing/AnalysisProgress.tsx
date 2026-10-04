import { useEffect, useState } from "react";

import type { InputRef } from "../../App";
import { bytes } from "../../lib/format";
import { Icon } from "../ui";

/* The engine answers in one response, so there are no per-stage events to stream.
 * Rather than animate fake checkmarks, this shows what the pipeline does with an
 * honest, indeterminate activity bar and elapsed time. The real per-stage timings,
 * measured server-side, appear in the technical audit once the result arrives. */
const STAGES = [
  ["Reading your report", "finding each test name, value and normal range"],
  ["Checking each result", "comparing every value with its normal range"],
  ["Looking across results", "some results only matter together"],
  ["Preparing your summary", "what is normal, what needs attention, and what to do next"],
] as const;

export function AnalysisProgress({ input, startedAt, onCancel }: { input: InputRef; startedAt: number; onCancel: () => void }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = (now - startedAt) / 1000;
  const name = input.kind === "file" ? input.file.name : `the example “${input.sample.title}”`;
  const size = input.kind === "file" ? input.file.size : input.sample.size_bytes;

  return (
    <div className="progress panel" role="status" aria-live="polite" aria-busy="true">
      <div className="progress-head">
        <span className="spinner" aria-hidden="true" />
        <div className="progress-title">
          <b>Checking {name}</b>
          <span className="muted small">
            {bytes(size)}, {elapsed.toFixed(0)} s so far
          </span>
        </div>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="progress-bar" aria-hidden="true">
        <i />
      </div>
      <ol className="progress-stages">
        {STAGES.map(([title, detail], i) => (
          <li key={title}>
            <span className="progress-n">{i + 1}</span>
            <span>
              <b>{title}</b>
              <span className="muted progress-detail">{detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="xs muted progress-note">
        <Icon name="clock" className="icon icon-xs" /> This usually takes a few seconds.
        {elapsed > 12 && " Large PDFs take longest to read."}
      </p>
    </div>
  );
}
