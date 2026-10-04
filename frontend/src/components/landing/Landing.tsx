import { useEffect, useRef } from "react";

import type { ApiError } from "../../api/client";
import type { Health, Sample } from "../../api/types";
import type { InputRef, RunState } from "../../App";
import type { Demographics } from "../../api/client";
import { num } from "../../lib/format";
import { ErrorState } from "../states/ErrorState";
import { Icon } from "../ui";
import { AnalysisProgress } from "./AnalysisProgress";
import { SampleGallery } from "./SampleGallery";
import { UploadPanel } from "./UploadPanel";

const STEPS = [
  ["Upload your report", "A PDF, CSV or JSON file from your lab."],
  ["We check every result", "Each value is compared with its normal range."],
  ["Read your summary", "What is normal, what needs attention, and what to do next."],
] as const;

export function Landing({ health, healthError, samples, samplesError, onReloadService, run, onAnalyse, onCancel, onDismissError, lastAnalysis }: {
  health: Health | null;
  healthError: ApiError | null;
  samples: Sample[] | null;
  samplesError: ApiError | null;
  onReloadService: () => void;
  run: RunState;
  onAnalyse: (input: InputRef, demo: Demographics) => void;
  onCancel: () => void;
  onDismissError: () => void;
  lastAnalysis: { name: string; open: () => void } | null;
}) {
  const busy = run.phase === "running";

  // Starting an example from the gallery below the fold would otherwise leave the
  // progress (and any error) off-screen. Bring it into view and give it focus, so
  // keyboard users land beside "Cancel" / "Choose another file".
  const action = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = action.current;
    if (!el || run.phase === "idle") return;
    const top = el.getBoundingClientRect().top;
    if (top < 56 || top > window.innerHeight * 0.5) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }
    el.focus({ preventScroll: true });
  }, [run.phase]);

  return (
    <div className="landing">
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-intro">
            <h1>Understand your lab report: what is normal, what needs attention, and what to do next.</h1>
            <p className="hero-lead">
              Upload a lab report. We check every result against its normal range and explain anything that stands out, in plain language.
            </p>
          </div>

          <div className="hero-action" ref={action} tabIndex={-1}>
            {lastAnalysis && run.phase === "idle" && (
              <button type="button" className="resume" onClick={lastAnalysis.open}>
                <Icon name="back" /> Return to the analysis of <span className="mono">{lastAnalysis.name}</span>
              </button>
            )}
            {run.phase === "running" ? (
              <AnalysisProgress input={run.input} startedAt={run.startedAt} onCancel={onCancel} />
            ) : run.phase === "error" ? (
              <ErrorState
                error={run.error}
                input={run.input}
                onRetry={() => onAnalyse(run.input, {})}
                onDismiss={onDismissError}
                onExamples={
                  samples?.length
                    ? () => {
                        onDismissError();
                        document.getElementById("examples")?.scrollIntoView({ block: "start" });
                      }
                    : undefined
                }
              />
            ) : (
              <UploadPanel maxMb={health?.limits.max_upload_mb ?? 20} busy={busy} onAnalyse={(file, demo) => onAnalyse({ kind: "file", file }, demo)} />
            )}
            {healthError && (
              <div className="callout callout-warn" role="alert">
                <Icon name="alert" />
                <div>
                  <b>The analysis service is not responding.</b> {healthError.hint ?? "It may still be starting up."}{" "}
                  <button type="button" className="btn btn-sm" onClick={onReloadService}>
                    Try again
                  </button>
                </div>
              </div>
            )}
            {health?.status === "config_error" && (
              <div className="callout callout-urgent" role="alert">
                <Icon name="alert" />
                <div>
                  <b>The engine's configuration failed validation.</b> Results would not be trustworthy until it is fixed ({health.errors.length} error
                  {health.errors.length === 1 ? "" : "s"}; see /api/health).
                </div>
              </div>
            )}
          </div>

          <div className="hero-how">
            <ol className="steps-plain" aria-label="How it works">
              {STEPS.map(([t, d], i) => (
                <li key={t}>
                  <span className="sp-n">{i + 1}</span>
                  <span className="sp-t">{t}</span>
                  <span className="sp-d">{d}</span>
                </li>
              ))}
            </ol>
            <p className="hero-disclaimer small">
              <Icon name="shield" className="icon" /> This tool does not diagnose. It helps you see what to discuss with your doctor.
            </p>
          </div>
        </div>
      </section>

      <section id="examples" className="container landing-block" aria-labelledby="samples-title">
        <div className="block-head">
          <h2 id="samples-title">No report to hand? Try an example</h2>
          <p className="muted small block-note">Made-up reports, so you can see what your results will look like.</p>
        </div>
        <SampleGallery samples={samples} error={samplesError} onRetry={onReloadService} busy={busy} onRun={(s) => onAnalyse({ kind: "sample", sample: s }, {})} />
      </section>

      <section className="container landing-block landing-more">
        <p className="small muted">
          Want to know how results are checked, or which medical reference is used?{" "}
          <a href="#/system">See how it works</a>
          {health ? ` — ${num(health.config.cohorts)} result patterns and ${num(health.config.diseases)} reference conditions.` : "."}
        </p>
      </section>
    </div>
  );
}
