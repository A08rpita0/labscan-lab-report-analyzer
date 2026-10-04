import { useMemo, useState } from "react";

import type { Analysis, Recommendation } from "../../api/types";
import { num, refText } from "../../lib/format";
import { PRIORITY_WORD, TRACE_WORD, word } from "../../lib/labels";
import { EmptyState, Icon } from "../ui";
import type { Index } from "./model";

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const PRIORITY_HELP: Record<string, string> = {
  urgent: "Seek care now rather than waiting for a routine appointment.",
  high: "Arrange soon; these follow from the strongest or most time-sensitive signals.",
  medium: "Follow-up testing, monitoring and discussion at your next appointment.",
  low: "General guidance that applies broadly.",
};

function sourceLine(r: Recommendation, ix: Index): string {
  switch (r.trace) {
    case "disease_guidance":
      return `Disease Master field “${r.trace_detail.split(" > ")[1] ?? r.trace_detail}” for ${r.finding_display || r.finding}`;
    case "cohort_action":
      return `Action library for the pattern “${ix.cohortById.get(r.trace_detail)?.name ?? r.trace_detail}”`;
    case "parameter_action":
      return `Action library for the result “${ix.name(r.trace_detail)}”`;
    case "urgency":
      return `Triage rule for the ${r.trace_detail} tier`;
    case "coverage_gap":
      return "Missing markers of the reported signals, ranked by how many signals they would inform";
    case "lab_finding":
      return "Abnormal result not covered by any other step";
    default:
      return word(TRACE_WORD, r.trace);
  }
}

function Step({ r, ix, onOpenFinding, onShowInGraph, inGraph }: {
  r: Recommendation;
  ix: Index;
  onOpenFinding: (id: string) => void;
  onShowInGraph: (id: string) => void;
  inGraph: boolean;
}) {
  const risk = ix.riskByName.get(r.finding);
  return (
    <li className={`step prio-${r.priority}`}>
      <div className="step-top">
        <span className="badge badge-outline">{r.category}</span>
        {r.timeframe && (
          <span className="badge">
            <Icon name="clock" className="icon icon-xs" /> {r.timeframe}
          </span>
        )}
        <span className="step-for small">
          {risk ? (
            <button type="button" className="linkish" onClick={() => onOpenFinding(risk.disease_id)}>
              {r.finding_display || r.finding}
            </button>
          ) : (
            <span className="muted">{r.finding_display || r.finding}</span>
          )}
        </span>
      </div>
      <p className="step-text">{r.text}</p>
      <dl className="step-why">
        <div>
          <dt>Why it appears</dt>
          <dd>{r.because[0].toUpperCase() + r.because.slice(1)}.</dd>
        </div>
        <div>
          <dt>Produced by</dt>
          <dd>{sourceLine(r, ix)}</dd>
        </div>
        {r.values.length > 0 && (
          <div className="step-values-wrap">
            <dt>Results behind it</dt>
            <dd>
              <ul className="step-values">
                {r.values.map((v) => (
                  <li key={v.parameter_id} className={v.in_range ? "is-in" : "is-out"}>
                    <b>{v.name}</b> <span className="num">{num(v.value)}</span> <span className="muted">{typeof v.value === "number" ? v.unit ?? "" : ""}</span>
                    {refText(v.reference_low, v.reference_high) && <span className="xs muted num"> (ref {refText(v.reference_low, v.reference_high)})</span>}
                    {v.reading && <span className="xs"> · {v.reading}</span>}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      {inGraph && (
        <button type="button" className="linkish xs step-graph" onClick={() => onShowInGraph(`a:${r.id}`)}>
          trace this step in the evidence graph
        </button>
      )}
    </li>
  );
}

export function ActionPlan({ analysis: a, ix, onOpenFinding, onShowInGraph }: {
  analysis: Analysis;
  ix: Index;
  onOpenFinding: (id: string) => void;
  onShowInGraph: (id: string) => void;
}) {
  const categories = useMemo(() => [...new Set(a.recommendations.map((r) => r.category))], [a.recommendations]);
  const [cat, setCat] = useState<string | null>(null);
  const graphActions = useMemo(() => new Set(a.explainability.graph.nodes.filter((n) => n.type === "action").map((n) => n.ref)), [a]);
  const recs = cat ? a.recommendations.filter((r) => r.category === cat) : a.recommendations;

  if (!a.recommendations.length) return <EmptyState icon="route" title="The engine produced no plan steps for this report." />;

  return (
    <div className="plan">
      <div className="callout callout-info plan-note">
        <Icon name="info" />
        <div>
          <b>Engine-generated suggestions, not medical advice.</b> Each step is drawn from configured guidance and names the rule and results behind it. It names no drug, dose
          or treatment; whether any step applies is a clinician's judgement.
        </div>
      </div>
      <div className="segmented plan-filter" role="group" aria-label="Filter by category">
        <button type="button" aria-pressed={cat === null} onClick={() => setCat(null)}>
          All {a.recommendations.length}
        </button>
        {categories.map((c) => (
          <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
            {c} {a.recommendations.filter((r) => r.category === c).length}
          </button>
        ))}
      </div>
      {PRIORITIES.map((p) => {
        const list = recs.filter((r) => r.priority === p);
        if (!list.length) return null;
        return (
          <div key={p} className={`plan-group pg-${p}`}>
            <div className="plan-group-head">
              <h3>
                {PRIORITY_WORD[p]} <span className="num muted">{list.length}</span>
              </h3>
              <p className="xs muted">{PRIORITY_HELP[p]}</p>
            </div>
            <ol className="steps">
              {list.map((r) => (
                <Step key={r.id} r={r} ix={ix} onOpenFinding={onOpenFinding} onShowInGraph={onShowInGraph} inGraph={graphActions.has(r.id)} />
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
