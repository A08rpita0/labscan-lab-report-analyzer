import type { Analysis, EvidenceLevel } from "../../api/types";
import { num } from "../../lib/format";
import { LEVEL_WORD, PRIORITY_WORD, TIER_WORD } from "../../lib/labels";
import { Icon, Tip } from "../ui";
import type { Index } from "./model";

/* ------------------------------------------------------------------ overview */

export function Overview({ analysis: a, ix, onJump }: { analysis: Analysis; ix: Index; onJump: (id: string) => void }) {
  const s = a.summary;
  const supported = a.disease_risks.filter((r) => r.presentation_tier !== "insufficient");
  const levels: EvidenceLevel[] = ["High", "Moderate", "Low", "Limited"];
  const levelCounts = levels.map((l) => [l, supported.filter((r) => r.evidence_level === l).length] as const);
  const byPriority = ["urgent", "high", "medium", "low"].map((p) => [p, a.recommendations.filter((r) => r.priority === p).length] as const);
  const crossProfile = a.cohorts.filter((c) => c.cross_profile_rationale).length;
  const cands = a.explainability.condition_candidates;

  const funnel = [
    { n: s.observations_found, label: "observations extracted", sub: a.source_file.split(".").pop()?.toUpperCase() + " input", to: "audit" },
    { n: s.parameters_recognised, label: "results recognised", sub: s.derived_values ? `incl. ${s.derived_values} calculated` : "canonical parameters", to: "results" },
    { n: s.abnormal_count, label: "outside range", sub: s.decision_threshold_count ? `${s.decision_threshold_count} by guideline band` : "by lab or guideline", to: "results" },
    { n: s.cohorts_detected, label: "patterns fired", sub: `of ${s.cohorts_evaluated} rules evaluated`, to: "coverage" },
    { n: s.conditions_flagged, label: "signals reported", sub: `of ${cands.linked_from_fired_patterns} considered`, to: "findings" },
    { n: a.recommendations.length, label: "plan steps", sub: "each traceable to a rule", to: "plan" },
  ];

  return (
    <div className="overview">
      <ol className="funnel" aria-label="How the pipeline narrowed this report">
        {funnel.map((f, i) => (
          <li key={f.label}>
            <button type="button" onClick={() => onJump(f.to)}>
              <span className="funnel-n num">{num(f.n)}</span>
              <span className="funnel-l">{f.label}</span>
              <span className="funnel-s">{f.sub}</span>
            </button>
            {i < funnel.length - 1 && <span className="funnel-arrow" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="ov-grid">
        <div className="ov-card">
          <h3 className="ov-h">
            <Icon name="target" /> Signal overview
          </h3>
          <ul className="ov-list">
            {(["direct", "derived", "pattern", "insufficient"] as const).map((t) => (
              <li key={t}>
                <span>{TIER_WORD[t]}</span>
                <span className="num">{ix.byTier[t].length}</span>
              </li>
            ))}
            <li className={a.urgent_findings.length ? "is-urgent" : undefined}>
              <span>Time-critical</span>
              <span className="num">{a.urgent_findings.length}</span>
            </li>
          </ul>
          {supported.length > 0 && (
            <div className="composition">
              <div className="composition-label xs muted">
                Evidence level of supported signals{" "}
                <Tip>Strength of the configured match for each signal. Not a probability of disease.</Tip>
              </div>
              <div className="composition-bar" role="img" aria-label={levelCounts.map(([l, n]) => `${n} ${l}`).join(", ")}>
                {levelCounts.map(([l, n]) => n > 0 && <i key={l} className={`cb-${l}`} style={{ flexGrow: n }} title={`${LEVEL_WORD[l]}: ${n}`} />)}
              </div>
              <ul className="composition-legend">
                {levelCounts.map(([l, n]) => (
                  <li key={l}>
                    <i className={`cb-${l}`} /> {l} <span className="num">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="ov-card">
          <h3 className="ov-h">
            <Icon name="layers" /> Data coverage
          </h3>
          <p className="ov-cov">
            <span className={`coverage-pill cov-${a.coverage.overall.replace(/\s+/g, "-")}`}>{a.coverage.overall}</span>
            <span className="small muted">{a.coverage.note}</span>
          </p>
          <ul className="ov-list">
            <li>
              <span>Profiles touched</span>
              <span className="num">{s.profiles_touched.length}</span>
            </li>
            <li>
              <span>Unrecognised tests</span>
              <span className="num">{s.parameters_unmapped}</span>
            </li>
            <li>
              <span>Values rejected as unusable</span>
              <span className="num">{s.values_rejected}</span>
            </li>
            <li>
              <span>Duplicates resolved</span>
              <span className="num">{s.duplicates_resolved}</span>
            </li>
            <li>
              <span>Signals capped by thin data</span>
              <span className="num">{a.coverage.capped_conditions.length}</span>
            </li>
          </ul>
        </div>

        <div className="ov-card">
          <h3 className="ov-h">
            <Icon name="book" /> Evidence
          </h3>
          <ul className="ov-list">
            <li>
              <span>Clinical references behind fired patterns</span>
              <span className="num">{ix.firedCitations.length}</span>
            </li>
            <li>
              <span>Cross-profile patterns</span>
              <span className="num">{crossProfile}</span>
            </li>
            <li>
              <span>Signals suppressed by an exclusion rule</span>
              <span className="num">{s.suppressed_by_exclusion}</span>
            </li>
            <li>
              <span>Considered, below reporting floor or gated</span>
              <span className="num">{(cands.totals.below_reporting_floor ?? 0) + (cands.totals.gated ?? 0)}</span>
            </li>
            <li>
              <span>Results graded by a guideline band</span>
              <span className="num">{s.decision_threshold_count}</span>
            </li>
          </ul>
        </div>

        <div className="ov-card">
          <h3 className="ov-h">
            <Icon name="route" /> Next actions
          </h3>
          <ul className="ov-priorities">
            {byPriority.map(([p, n]) => (
              <li key={p} className={`prio-${p}`}>
                <span className="num">{n}</span>
                <span>{PRIORITY_WORD[p]}</span>
              </li>
            ))}
          </ul>
          <ol className="ov-steps small">
            {a.recommendations.slice(0, 3).map((r) => (
              <li key={r.id}>{r.text.length > 120 ? r.text.slice(0, 118) + "…" : r.text}</li>
            ))}
          </ol>
          <button type="button" className="btn btn-sm btn-ghost ov-more" onClick={() => onJump("plan")}>
            Open the action plan
          </button>
        </div>
      </div>
    </div>
  );
}
