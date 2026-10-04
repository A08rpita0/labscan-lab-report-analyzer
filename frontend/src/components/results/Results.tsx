import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import type { Analysis } from "../../api/types";
import type { InputRef } from "../../App";
import { classifyResults } from "../../lib/classify";
import { Icon } from "../ui";
import { DetailsPanel, type DetailTab } from "./DetailsPanel";
import { buildIndex } from "./model";
import { ReportHeader } from "./ReportHeader";
import { NeedsAttention, NextSteps, NormalResults, Summary, WhatItMeans } from "./SimpleView";

/* Results, in the order a first-time reader needs them:
 *
 *   Summary -> What needs attention -> What it means -> What to do next -> Normal results
 *
 * followed by one "See details" disclosure holding every technical view. Nothing on the
 * main path uses engine vocabulary; the details keep all of it, unchanged. */
export function Results({ analysis, input, onNew, onRerun, rerunning }: {
  analysis: Analysis;
  input: InputRef;
  onNew: () => void;
  onRerun: (sex: "male" | "female") => void;
  rerunning: boolean;
}) {
  const ix = useMemo(() => buildIndex(analysis), [analysis]);
  const groups = useMemo(() => classifyResults(analysis), [analysis]);
  const [focus, setFocus] = useState<string | null>(null);
  const [openFindings, setOpenFindings] = useState<Set<string>>(() => new Set());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>("reasoning");
  const [printAll, setPrintAll] = useState(false);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const toggleFinding = useCallback((id: string, force?: boolean) => {
    setOpenFindings((prev) => {
      const next = new Set(prev);
      const want = force ?? !next.has(id);
      if (want) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** Open the details on the reasoning for one finding, and bring it into view. */
  const explainFinding = useCallback(
    (diseaseId: string) => {
      setDetailsOpen(true);
      setTab("reasoning");
      toggleFinding(diseaseId, true);
      window.setTimeout(() => document.getElementById(`finding-${diseaseId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    },
    [toggleFinding],
  );

  const showInGraph = useCallback(
    (nodeId: string) => {
      setDetailsOpen(true);
      setTab("graph");
      setFocus(nodeId);
      window.setTimeout(() => scrollTo("details"), 60);
    },
    [scrollTo],
  );

  const setAllFindings = (on: boolean) => setOpenFindings(on ? new Set(analysis.disease_risks.map((r) => r.disease_id)) : new Set());

  // Printing. A summary prints the simple view with the normal results listed; a full
  // report also prints every detail view with each supported finding expanded. State is
  // changed synchronously (the browser lays the page out right after beforeprint) and
  // restored afterwards. Idempotent: Chrome fires beforeprint twice when making a PDF.
  useEffect(() => {
    let saved: { findings: Set<string>; details: boolean } | null = null;
    let printing = false;
    const before = () => {
      if (printing) return;
      printing = true;
      const full = document.documentElement.dataset.printMode !== "summary";
      document.querySelectorAll<HTMLDetailsElement>(full ? "details" : "details.print-open").forEach((d) => {
        d.dataset.printRestore = d.open ? "open" : "closed";
        d.open = true;
      });
      if (!full) return;
      flushSync(() => {
        setOpenFindings((prev) => {
          saved = { findings: prev, details: false };
          return new Set(analysis.disease_risks.filter((r) => r.presentation_tier !== "insufficient").map((r) => r.disease_id));
        });
        setDetailsOpen((prev) => {
          if (saved) saved.details = prev;
          return true;
        });
        setPrintAll(true);
      });
      document.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => {
        if (!d.dataset.printRestore) d.dataset.printRestore = d.open ? "open" : "closed";
        d.open = true;
      });
    };
    const after = () => {
      if (!printing) return;
      printing = false;
      setPrintAll(false);
      if (saved) {
        setOpenFindings(saved.findings);
        setDetailsOpen(saved.details);
        saved = null;
      }
      document.querySelectorAll<HTMLDetailsElement>("details[data-print-restore]").forEach((d) => {
        d.open = d.dataset.printRestore === "open";
        delete d.dataset.printRestore;
      });
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [analysis]);

  return (
    <div className="results">
      <ReportHeader analysis={analysis} input={input} onNew={onNew} />

      <div className="simple">
        <Summary analysis={analysis} groups={groups} onJump={scrollTo} onRerun={onRerun} rerunning={rerunning} />
        <NeedsAttention groups={groups} labNotes={analysis.lab_noted_findings.length} />
        <WhatItMeans analysis={analysis} ix={ix} onExplain={explainFinding} />
        <NextSteps analysis={analysis} />
        <NormalResults items={groups.normal} />

        <section className="simple-sec disclaimer-plain" aria-labelledby="disclaimer-title">
          <Icon name="shield" />
          <div>
            <h2 id="disclaimer-title" className="simple-h simple-h-small">
              This is not a diagnosis
            </h2>
            <p>{analysis.disclaimer}</p>
          </div>
        </section>

        <DetailsPanel
          analysis={analysis}
          ix={ix}
          open={detailsOpen}
          setOpen={setDetailsOpen}
          tab={tab}
          setTab={setTab}
          printAll={printAll}
          focus={focus}
          setFocus={setFocus}
          openFindings={openFindings}
          toggleFinding={toggleFinding}
          setAllFindings={setAllFindings}
          onOpenFinding={explainFinding}
          onShowInGraph={showInGraph}
        />
      </div>
    </div>
  );
}
