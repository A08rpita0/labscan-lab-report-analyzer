/* "See details": every advanced view, kept out of the beginner's way.
 *
 * The evidence graph, the reasoning trace behind each finding, the full results table,
 * data coverage, the medical reference and the technical audit are unchanged - they are
 * only moved behind one disclosure, shown one tab at a time (all of them for a full
 * printout). */

import type { ReactNode } from "react";

import type { Analysis } from "../../api/types";
import { EvidenceGraph } from "../graph/EvidenceGraph";
import { CopyButton, Icon } from "../ui";
import { downloadJson, printReport, textSummary } from "./exporters";
import { ActionPlan } from "./ActionPlan";
import { ClinicalReference } from "./ClinicalReference";
import { CoveragePanel } from "./Coverage";
import { Findings } from "./Findings";
import type { Index } from "./model";
import { Overview } from "./Overview";
import { ParameterExplorer } from "./ParameterExplorer";
import { TechnicalAudit } from "./TechnicalAudit";

export const DETAIL_TABS = [
  ["reasoning", "How each finding was worked out"],
  ["graph", "Evidence graph"],
  ["results", "All results"],
  ["coverage", "Data coverage"],
  ["plan", "Full action plan"],
  ["reference", "Medical reference"],
  ["audit", "Technical audit"],
] as const;

export type DetailTab = (typeof DETAIL_TABS)[number][0];

const LEADS: Record<DetailTab, string> = {
  reasoning:
    "For each finding: the values read from your report, how they were checked, which rules matched, how strongly each piece counted, and what data was missing.",
  graph:
    "Every line is a relationship the engine recorded: a result that matched a rule, a rule that pointed to a condition, a condition that led to a suggestion. Select any box to trace it.",
  results: "Every recognised result. Search, filter and expand a row to see exactly how it was graded and what uses it.",
  coverage: "How much of the relevant data your report contained. This is about completeness, not about how certain anything is.",
  plan: "Every suggestion with the rule and results that produced it.",
  reference: "The medical reference entries behind these findings, quoted word for word, with their review status.",
  audit: "Pipeline timings, configuration fingerprint, rule-by-rule numbers and the raw response.",
};

export function DetailsPanel({ analysis, ix, open, setOpen, tab, setTab, printAll, focus, setFocus, openFindings, toggleFinding, setAllFindings, onOpenFinding, onShowInGraph }: {
  analysis: Analysis;
  ix: Index;
  open: boolean;
  setOpen: (v: boolean) => void;
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
  printAll: boolean;
  focus: string | null;
  setFocus: (id: string | null) => void;
  openFindings: Set<string>;
  toggleFinding: (id: string, force?: boolean) => void;
  setAllFindings: (on: boolean) => void;
  onOpenFinding: (id: string) => void;
  onShowInGraph: (nodeId: string) => void;
}) {
  const body = (t: DetailTab): ReactNode => {
    switch (t) {
      case "reasoning":
        return (
          <>
            {analysis.disease_risks.length > 0 && (
              <div className="btn-row details-tools no-print">
                <button type="button" className="btn btn-sm" onClick={() => setAllFindings(true)}>
                  <Icon name="expand" /> Expand all
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setAllFindings(false)}>
                  <Icon name="collapse" /> Collapse all
                </button>
              </div>
            )}
            <Findings analysis={analysis} ix={ix} open={openFindings} toggle={toggleFinding} onShowInGraph={onShowInGraph} />
          </>
        );
      case "graph":
        return <EvidenceGraph analysis={analysis} focus={focus} setFocus={setFocus} onOpenFinding={onOpenFinding} />;
      case "results":
        return <ParameterExplorer analysis={analysis} ix={ix} onShowInGraph={onShowInGraph} onOpenFinding={onOpenFinding} />;
      case "coverage":
        return <CoveragePanel analysis={analysis} ix={ix} onOpenFinding={onOpenFinding} />;
      case "plan":
        return <ActionPlan analysis={analysis} ix={ix} onOpenFinding={onOpenFinding} onShowInGraph={onShowInGraph} />;
      case "reference":
        return <ClinicalReference analysis={analysis} />;
      case "audit":
        return (
          <>
            <Overview analysis={analysis} ix={ix} onJump={(id) => setTab(id === "plan" ? "plan" : id === "results" ? "results" : id === "coverage" ? "coverage" : id === "findings" ? "reasoning" : "audit")} />
            <div className="details-gap" />
            <TechnicalAudit analysis={analysis} ix={ix} />
          </>
        );
    }
  };

  const shown: DetailTab[] = printAll ? DETAIL_TABS.filter(([t]) => t !== "graph").map(([t]) => t) : [tab];

  return (
    <section id="details" className={`details-panel${open ? " is-open" : ""}`} aria-labelledby="details-title">
      <button type="button" className="details-toggle" aria-expanded={open} aria-controls="details-body" onClick={() => setOpen(!open)}>
        <span className="details-toggle-text">
          <span id="details-title" className="details-title">
            See details
          </span>
          <span className="details-sub">
            For you or your doctor: how each finding was worked out, the evidence graph, every result, the medical reference and the technical audit.
          </span>
        </span>
        <span className="details-chev" aria-hidden="true" />
      </button>

      {open && (
        <div id="details-body" className="details-body fade-in">
          <div className="details-exports no-print">
            <button type="button" className="btn btn-sm" onClick={() => printReport("full")}>
              <Icon name="print" /> Print full report
            </button>
            <CopyButton text={() => textSummary(analysis)} label="Copy summary" />
            <button type="button" className="btn btn-sm" onClick={() => downloadJson(analysis)}>
              <Icon name="download" /> Download data (JSON)
            </button>
          </div>
          {!printAll && (
            <div className="details-tabs" role="tablist" aria-label="Detail views">
              {DETAIL_TABS.map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={`dtab-${t}`}
                  aria-selected={tab === t}
                  aria-controls={`dpanel-${t}`}
                  tabIndex={tab === t ? 0 : -1}
                  className={`details-tab${tab === t ? " is-active" : ""}`}
                  onClick={() => setTab(t)}
                  onKeyDown={(e) => {
                    const i = DETAIL_TABS.findIndex(([x]) => x === t);
                    const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                    if (!move) return;
                    e.preventDefault();
                    const next = DETAIL_TABS[(i + move + DETAIL_TABS.length) % DETAIL_TABS.length][0];
                    setTab(next);
                    document.getElementById(`dtab-${next}`)?.focus();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {shown.map((t) => (
            <div key={t} id={`dpanel-${t}`} role="tabpanel" aria-labelledby={`dtab-${t}`} className="details-pane">
              {printAll && <h3 className="details-print-h">{DETAIL_TABS.find(([x]) => x === t)![1]}</h3>}
              <p className="details-lead">{LEADS[t]}</p>
              {body(t)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
