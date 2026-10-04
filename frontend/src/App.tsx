import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api, type Demographics } from "./api/client";
import type { Analysis, Health, Sample } from "./api/types";
import { AppShell } from "./components/AppShell";
import { Landing } from "./components/landing/Landing";
import { ErrorState } from "./components/states/ErrorState";
import { Results } from "./components/results/Results";
import { SystemReference } from "./components/system/SystemReference";
import { useHashRoute } from "./lib/hooks";

export type InputRef = { kind: "file"; file: File } | { kind: "sample"; sample: Sample };

export type RunState =
  | { phase: "idle" }
  | { phase: "running"; input: InputRef; startedAt: number }
  | { phase: "error"; input: InputRef; error: ApiError };

export function App() {
  const [route, go] = useHashRoute();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<ApiError | null>(null);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [samplesError, setSamplesError] = useState<ApiError | null>(null);
  const [analysis, setAnalysis] = useState<{ result: Analysis; input: InputRef; demographics: Demographics } | null>(null);
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const inflight = useRef<AbortController | null>(null);

  // A failed load is kept as an error, never shown as "no samples": on a sleeping host the
  // first requests can time out while the service is still waking up.
  const loadService = useCallback(() => {
    setHealthError(null);
    setSamplesError(null);
    setSamples(null);
    api.health().then(setHealth, (e: ApiError) => setHealthError(e));
    api.samples().then(setSamples, (e: ApiError) => setSamplesError(e));
  }, []);

  useEffect(() => {
    loadService();
  }, [loadService]);

  // An analysis lives in memory only. Landing on #/analysis without one (a reload, a
  // shared link) goes back to the start rather than showing an empty shell.
  useEffect(() => {
    if (route === "analysis" && !analysis && run.phase !== "running") go("home");
  }, [route, analysis, run.phase, go]);

  // A new page starts at its top; in-page section jumps use element scrolling instead.
  // Screen-reader and keyboard users land on the new page's content, not on the link
  // they activated (WCAG focus-on-route-change). Skipped on first load.
  const firstRoute = useRef(true);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [route]);

  useEffect(() => {
    document.title = route === "analysis" && analysis
      ? `Your results: ${analysis.result.source_file} | LabScan`
      : route === "system" ? "How it works | LabScan" : "LabScan — Explainable Lab Report Analyzer";
  }, [route, analysis]);

  const start = useCallback(
    async (input: InputRef, demographics: Demographics) => {
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      setRun({ phase: "running", input, startedAt: performance.now() });
      try {
        const result = input.kind === "file"
          ? await api.analyseFile(input.file, demographics, ctrl.signal)
          : await api.analyseSample(input.sample.file, demographics, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setAnalysis({ result, input, demographics });
        setRun({ phase: "idle" });
        go("analysis");
        window.scrollTo({ top: 0 });
      } catch (e) {
        if (e instanceof ApiError && e.code === "cancelled") {
          setRun({ phase: "idle" });
          return;
        }
        const err = e instanceof ApiError ? e : new ApiError("client_error", "Something went wrong while showing this analysis.");
        setRun({ phase: "error", input, error: err });
      } finally {
        if (inflight.current === ctrl) inflight.current = null;
      }
    },
    [go],
  );

  const cancel = useCallback(() => inflight.current?.abort(), []);
  const reset = useCallback(() => {
    setRun({ phase: "idle" });
    go("home");
    window.scrollTo({ top: 0 });
  }, [go]);

  return (
    <AppShell route={route} go={go} health={health} hasAnalysis={!!analysis}>
      {route === "system" ? (
        <SystemReference health={health} />
      ) : route === "analysis" && analysis ? (
        <>
        {run.phase === "error" && (
          <div className="container rerun-error">
            <ErrorState error={run.error} input={run.input} onRetry={() => start(run.input, analysis.demographics)} onDismiss={() => setRun({ phase: "idle" })} />
          </div>
        )}
        <Results
          key={analysis.result.generated_at + analysis.result.source_file}
          analysis={analysis.result}
          input={analysis.input}
          onNew={reset}
          onRerun={(sex) => start(analysis.input, { ...analysis.demographics, sex })}
          rerunning={run.phase === "running"}
        />
        </>
      ) : (
        <Landing
          health={health}
          healthError={healthError}
          samples={samples}
          samplesError={samplesError}
          onReloadService={loadService}
          run={run}
          onAnalyse={start}
          onCancel={cancel}
          onDismissError={() => setRun({ phase: "idle" })}
          lastAnalysis={analysis ? { name: analysis.result.source_file, open: () => go("analysis") } : null}
        />
      )}
    </AppShell>
  );
}
