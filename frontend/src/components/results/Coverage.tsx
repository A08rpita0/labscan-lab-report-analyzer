import { useMemo, useState } from "react";

import type { Analysis, CohortEvaluationRow } from "../../api/types";
import { num, pct, plural } from "../../lib/format";
import { CANDIDATE_STATUS_WORD, COHORT_STATUS_WORD, word } from "../../lib/labels";
import { profilesOf } from "../../lib/explorer";
import { Meter, Tip } from "../ui";
import { riskName, type Index } from "./model";

const STATUS_ORDER: CohortEvaluationRow["status"][] = ["fired", "not_met", "not_assessable", "no_data", "not_applicable", "suppressed"];

export function CoveragePanel({ analysis: a, ix, onOpenFinding }: { analysis: Analysis; ix: Index; onOpenFinding: (id: string) => void }) {
  const s = a.summary;
  const profiles = useMemo(() => profilesOf(a.parameters), [a.parameters]);
  const maxProfile = Math.max(1, ...profiles.map((p) => p.total));
  const ev = a.explainability.cohort_evaluation;
  const cands = a.explainability.condition_candidates;
  const [hoverRule, setHoverRule] = useState<CohortEvaluationRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const supported = a.disease_risks.filter((r) => r.presentation_tier !== "insufficient").sort((x, y) => x.data_coverage - y.data_coverage);

  const byCategory = useMemo(() => {
    const m = new Map<string, CohortEvaluationRow[]>();
    for (const r of ev.rules) {
      const k = r.category || "Other";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [ev.rules]);

  const ledger: [string, number, string][] = [
    ["Observations extracted", s.observations_found, "name/value pairs read from the file"],
    ["Recognised as known tests", s.parameters_recognised - s.derived_values, "resolved through the alias dictionary"],
    ["Calculated by the engine", s.derived_values, "ratios and indices from measured inputs only"],
    ["Unrecognised tests", s.parameters_unmapped, "result-shaped, but not in the dictionary"],
    ["Document fields skipped", s.document_fields_skipped, "envelope fields such as lab numbers and dates"],
    ["Values rejected as unusable", s.values_rejected, "impossible or unreadable; counted as not measured"],
    ["Results pending", s.results_pending, "printed as not yet reported"],
    ["Duplicates resolved", s.duplicates_resolved, "the most informative record kept; conflicts reported"],
  ];

  return (
    <div className="coverage">
      <div className="cov-grid">
        <div className="cov-card">
          <h3 className="ov-h">Extraction and normalization ledger</h3>
          <table className="table ledger">
            <tbody>
              {ledger.map(([label, n, help]) => (
                <tr key={label} className={n === 0 ? "is-zero" : undefined}>
                  <td>
                    {label}
                    <div className="xs muted">{help}</div>
                  </td>
                  <td className="num">{num(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cov-card">
          <h3 className="ov-h">
            Profile coverage{" "}
            <Tip>Results recognised per profile, with how many fall outside range. Counts, not percentages: no report is expected to contain a whole catalogue profile.</Tip>
          </h3>
          <ul className="profile-bars">
            {profiles.map((p) => (
              <li key={p.profile}>
                <span className="pb-name small">{p.profile}</span>
                <span className="pb-bar" aria-hidden="true">
                  <i className="pb-total" style={{ width: `${(p.total / maxProfile) * 100}%` }} />
                  <i className="pb-abn" style={{ width: `${(p.abnormal / maxProfile) * 100}%` }} />
                </span>
                <span className="pb-n num xs">
                  {p.abnormal}/{p.total}
                </span>
              </li>
            ))}
          </ul>
          <p className="xs muted pb-legend">
            <i className="pb-key pb-key-abn" /> outside range <i className="pb-key pb-key-total" /> recognised
          </p>
        </div>
      </div>

      <div className="cov-card">
        <div className="rulemap-head">
          <h3 className="ov-h">
            Rule evaluation map — all {ev.configured} pattern rules{" "}
            <Tip>Every configured cohort rule is evaluated on every report. This shows what became of each one, so “no signal” can be told apart from “never assessable”.</Tip>
          </h3>
          <ul className="rulemap-legend" role="group" aria-label="Filter rules by outcome">
            {STATUS_ORDER.filter((k) => ev.totals[k]).map((k) => (
              <li key={k}>
                <button type="button" aria-pressed={statusFilter === k} className={`rm-key rs-${k}`} onClick={() => setStatusFilter(statusFilter === k ? null : k)}>
                  <i /> {word(COHORT_STATUS_WORD, k)} <span className="num">{ev.totals[k]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="rulemap">
          {byCategory.map(([cat, rules]) => (
            <div key={cat} className="rm-row">
              <span className="rm-cat xs">{cat}</span>
              <span className="rm-cells">
                {rules.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`rm-cell rs-${r.status}${statusFilter && statusFilter !== r.status ? " is-dim" : ""}`}
                    aria-label={`${r.name}: ${word(COHORT_STATUS_WORD, r.status)}`}
                    onMouseEnter={() => setHoverRule(r)}
                    onFocus={() => setHoverRule(r)}
                  />
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="rm-detail small" aria-live="polite">
          {hoverRule ? (
            <>
              <b>{hoverRule.name}</b> — {word(COHORT_STATUS_WORD, hoverRule.status)}
              {hoverRule.confidence !== undefined && ` (confidence ${hoverRule.confidence.toFixed(2)})`}. {hoverRule.reason ? hoverRule.reason + ". " : ""}
              <span className="muted">
                {hoverRule.parameters_present} of {hoverRule.parameters_referenced} referenced parameters present.
              </span>
            </>
          ) : (
            <span className="muted">Hover or focus a cell to see the rule and why it did or did not fire.</span>
          )}
        </p>
        {statusFilter && (
          <ul className="rm-list small">
            {ev.rules
              .filter((r) => r.status === statusFilter)
              .map((r) => (
                <li key={r.id}>
                  <b>{r.name}</b> <span className="muted">{r.reason ?? ""}</span>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="cov-grid">
        <div className="cov-card">
          <h3 className="ov-h">
            Coverage per signal{" "}
            <Tip>Contribution-weighted share of the markers relevant to each signal that were measured. Below 60% the level is capped at Moderate; below 34% it steps down a band.</Tip>
          </h3>
          {supported.length ? (
            <ul className="sigcov">
              {supported.map((r) => (
                <li key={r.disease_id}>
                  <button type="button" className="linkish small" onClick={() => onOpenFinding(r.disease_id)}>
                    {riskName(r)}
                  </button>
                  <Meter value={r.data_coverage} tone={r.evidence_capped ? "slate" : "blue"} label={`Coverage for ${riskName(r)}`} />
                  <span className="num xs">{pct(r.data_coverage)}</span>
                  <span className="xs muted sigcov-miss" title={r.missing_parameters.map(ix.name).join(", ")}>
                    {r.missing_parameters.length ? `${plural(r.missing_parameters.length, "marker")} not measured` : "all measured"}
                    {r.evidence_capped ? " · level capped" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">No supported signals to assess.</p>
          )}
          {a.coverage.capped_note && <p className="xs muted cov-capnote">{a.coverage.capped_note}</p>}
        </div>

        <div className="cov-card">
          <h3 className="ov-h">
            Conditions considered{" "}
            <Tip>Every Disease Master row linked from a fired pattern, and what became of it. The reporting floor is {cands.reporting_floor}.</Tip>
          </h3>
          <ul className="ov-list">
            {Object.entries(cands.totals).map(([k, n]) => (
              <li key={k}>
                <span>{word(CANDIDATE_STATUS_WORD, k)}</span>
                <span className="num">{n}</span>
              </li>
            ))}
          </ul>
          {cands.rows.some((r) => r.status !== "reported") && (
            <details className="disclosure">
              <summary>Not reported ({cands.rows.filter((r) => r.status !== "reported").length})</summary>
              <ul className="small cand-list">
                {cands.rows
                  .filter((r) => r.status !== "reported")
                  .map((r) => (
                    <li key={r.name}>
                      <b>{r.name}</b> <span className="muted xs">— {word(CANDIDATE_STATUS_WORD, r.status)}; via {r.via.join(", ")}</span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      {(a.unmapped_observations.length > 0 || a.rejected_values.length > 0 || a.duplicates_resolved.length > 0) && (
        <div className="cov-card">
          <h3 className="ov-h">Data-quality detail</h3>
          {a.unmapped_observations.length > 0 && (
            <details className="disclosure" open={a.unmapped_observations.length <= 6}>
              <summary>Unrecognised tests ({a.unmapped_observations.length}) — read, but not in the parameter dictionary</summary>
              <ul className="small dq-list">
                {a.unmapped_observations.map((o, i) => (
                  <li key={i}>
                    <span className="mono">{String(o.raw_name)}</span> = {String(o.raw_value)} {o.raw_unit ?? ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {a.rejected_values.length > 0 && (
            <details className="disclosure" open>
              <summary>Rejected values ({a.rejected_values.length})</summary>
              <ul className="small dq-list">
                {a.rejected_values.map((v, i) => (
                  <li key={i}>
                    <b>{v.parameter}</b> reported as “{String(v.reported)}” — {v.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {a.duplicates_resolved.length > 0 && (
            <details className="disclosure" open>
              <summary>Duplicates resolved ({a.duplicates_resolved.length})</summary>
              <ul className="small dq-list">
                {a.duplicates_resolved.map((d, i) => (
                  <li key={i}>
                    <b>{d.parameter}</b>: {d.occurrences} records, kept {num(d.kept?.value)} {d.kept?.unit ?? ""} — {d.reason}
                    {d.conflicting_values && <span className="badge badge-amber dq-conflict">values differed</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
