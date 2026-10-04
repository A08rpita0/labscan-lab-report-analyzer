import { useMemo, useState } from "react";

import type { Analysis } from "../../api/types";
import { bytes, ms, num, pct, score } from "../../lib/format";
import { PRIORITY_WORD, ROLE_WORD, STAGE_WORD, TRACE_WORD, word } from "../../lib/labels";
import { CopyButton, Icon } from "../ui";
import type { Index } from "./model";

function count<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function RawJson({ analysis }: { analysis: Analysis }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const text = useMemo(() => (open ? JSON.stringify(analysis, null, 2) : ""), [open, analysis]);
  const LIMIT = 120_000;
  return (
    <div className="raw">
      <div className="raw-head">
        <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="code" /> {open ? "Hide raw analysis JSON" : "View raw analysis JSON"}
        </button>
        {open && (
          <>
            <span className="xs muted">{bytes(new Blob([text]).size)}</span>
            <CopyButton text={() => text} label="Copy JSON" />
          </>
        )}
      </div>
      {open && (
        <>
          <pre className="code-block raw-pre" tabIndex={0}>
            {full || text.length <= LIMIT ? text : text.slice(0, LIMIT) + "\n…"}
          </pre>
          {!full && text.length > LIMIT && (
            <button type="button" className="linkish xs" onClick={() => setFull(true)}>
              Show the remaining {bytes(text.length - LIMIT)}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function TechnicalAudit({ analysis: a, ix }: { analysis: Analysis; ix: Index }) {
  const run = a.run;
  const maxStage = Math.max(0.001, ...run.stages.map((s) => s.ms));
  const sourceKinds = count(a.parameters.filter((p) => p.raw), (p) => p.raw!.source_kind);
  const refSources = count(a.parameters, (p) => p.reference_source);
  const conversions = a.parameters.filter((p) => p.conversion_note);
  const docSignals = a.document?.signals ?? {};
  const contributions = a.disease_risks.flatMap((r) => r.contributions.map((c) => ({ r, c })));
  const cfg = a.engine.config;

  return (
    <div className="audit">
      <div className="audit-grid">
        <div className="audit-card">
          <h3 className="ov-h">
            <Icon name="clock" /> Stage timings
          </h3>
          <ul className="timings">
            {run.stages.map((s) => (
              <li key={s.stage}>
                <span className="small">{word(STAGE_WORD, s.stage)}</span>
                <span className="tm-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(1.5, (s.ms / maxStage) * 100)}%` }} />
                </span>
                <span className="num xs">{ms(s.ms)}</span>
              </li>
            ))}
          </ul>
          <p className="xs muted">
            Total <b className="num">{ms(run.total_ms)}</b> · {run.clock}.
          </p>
        </div>

        <div className="audit-card">
          <h3 className="ov-h">
            <Icon name="shield" /> Engine and configuration
          </h3>
          <dl className="kv">
            <dt>Engine version</dt>
            <dd className="mono">{a.engine.version}</dd>
            <dt>Config fingerprint</dt>
            <dd className="mono">
              sha256:{cfg.sha256} <span className="muted xs">({cfg.files} files)</span>
            </dd>
            <dt>Parameter dictionary</dt>
            <dd>v{cfg.parameter_dictionary_version}</dd>
            <dt>Disease Master</dt>
            <dd>
              {cfg.disease_master_source} · updated {cfg.disease_master_last_updated}
            </dd>
            <dt>Rules configured</dt>
            <dd>
              {a.provenance.cohorts_configured} patterns · {a.provenance.evidence_citations} distinct citations
            </dd>
            <dt>Determinism</dt>
            <dd>No randomness or learned weights; identical input gives an identical analysis.</dd>
            <dt>Generated</dt>
            <dd className="mono xs">{a.generated_at}</dd>
          </dl>
        </div>
      </div>

      <div className="audit-grid">
        <div className="audit-card">
          <h3 className="ov-h">Extraction</h3>
          <dl className="kv">
            <dt>Document verdict</dt>
            <dd>{a.document.status}{a.document.incomplete ? " (incomplete)" : ""}</dd>
            <dt>Source structure</dt>
            <dd>{sourceKinds.map(([k, n]) => `${n} from ${k}`).join(" · ") || "—"}</dd>
            <dt>Text characters</dt>
            <dd className="num">{num(docSignals.text_characters as number)}</dd>
            <dt>Report phrases found</dt>
            <dd>{num(docSignals.report_phrases_found as number)}</dd>
            <dt>Warnings</dt>
            <dd>{a.warnings.length ? a.warnings.join("; ") : "none"}</dd>
          </dl>
        </div>
        <div className="audit-card">
          <h3 className="ov-h">Normalization</h3>
          <dl className="kv">
            <dt>Reference interval source</dt>
            <dd>{refSources.map(([k, n]) => `${n} ${k}`).join(" · ")}</dd>
            <dt>Graded by guideline band</dt>
            <dd>{a.summary.decision_threshold_count}</dd>
            <dt>Unit conversions</dt>
            <dd>
              {conversions.length ? (
                <ul className="xs audit-ul">
                  {conversions.map((p) => (
                    <li key={p.parameter_id}>
                      <b>{p.name}</b>: {p.conversion_note}
                    </li>
                  ))}
                </ul>
              ) : (
                "none needed"
              )}
            </dd>
          </dl>
        </div>
      </div>

      <details className="disclosure audit-sec" open>
        <summary>Pattern rules that fired ({a.cohorts.length})</summary>
        {a.cohorts.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pattern</th>
                  <th>Mode</th>
                  <th className="num">Confidence</th>
                  <th className="num">Coverage</th>
                  <th>Signals counted</th>
                  <th>Confidence build-up</th>
                </tr>
              </thead>
              <tbody>
                {a.cohorts.map((c) => {
                  const b = c.confidence_breakdown as Record<string, any>;
                  return (
                    <tr key={c.cohort_id}>
                      <td>
                        <b>{c.name}</b>
                        <div className="xs muted mono">{c.cohort_id}</div>
                      </td>
                      <td className="small">{c.mode}</td>
                      <td className="num">{score(c.confidence)}</td>
                      <td className="num">{pct(c.data_coverage)}</td>
                      <td className="small">{c.hits.filter((h) => h.effective_weight > 0).map((h) => h.parameter_name).join(", ")}</td>
                      <td className="mono xs">
                        {b.mode === "weighted"
                          ? `${score(b.fired_weight)} / (${score(b.denominator?.required_trigger_weight)} + ${score(b.denominator?.measured_support_allowance)}) = ${score(b.raw_confidence)} × ${score(b.coverage_factor)}`
                          : `${b.components_met}/${b.components_total} met (≥${b.components_required}) → ${score(b.raw_confidence)} × ${score(b.coverage_factor)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">None fired.</p>
        )}
      </details>

      <details className="disclosure audit-sec">
        <summary>Disease Master mapping — every contribution ({contributions.length})</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>From pattern</th>
                <th>Role</th>
                <th className="num">Link</th>
                <th className="num">Conf.</th>
                <th className="num">Damping</th>
                <th className="num">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map(({ r, c }) => (
                <tr key={r.disease_id + c.cohort_id}>
                  <td className="small">{r.name}</td>
                  <td className="small">{c.cohort_name}</td>
                  <td className="small">{word(ROLE_WORD, c.role)}</td>
                  <td className="num">{score(c.link_weight)}</td>
                  <td className="num">{score(c.cohort_confidence)}</td>
                  <td className="num">{score(c.support_penalty)}</td>
                  <td className="num">
                    <b>{score(c.contribution, 3)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="disclosure audit-sec">
        <summary>Recommendation mapping ({a.recommendations.length})</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Priority</th>
                <th>Category</th>
                <th>Rule</th>
                <th>Rule detail</th>
                <th>Titled by</th>
              </tr>
            </thead>
            <tbody>
              {a.recommendations.map((r) => (
                <tr key={r.id}>
                  <td className="mono xs">{r.id}</td>
                  <td className="small">{word(PRIORITY_WORD, r.priority)}</td>
                  <td className="small">{r.category}</td>
                  <td className="small">{word(TRACE_WORD, r.trace)}</td>
                  <td className="mono xs">{r.trace_detail}</td>
                  <td className="small">
                    {r.finding_display || r.finding} <span className="muted xs">({r.finding_kind})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {(a.suppressed_findings.length > 0 || a.cohorts_not_assessable.length > 0) && (
        <details className="disclosure audit-sec">
          <summary>Exclusions and unassessable rules ({a.suppressed_findings.length + a.cohorts_not_assessable.length})</summary>
          <ul className="small audit-ul">
            {a.suppressed_findings.map((s, i) => (
              <li key={"s" + i}>
                <b>{s.disease ?? s.name}</b> suppressed by <span className="mono">{s.rule_id}</span> — {s.reason}
              </li>
            ))}
            {a.cohorts_not_assessable.map((c) => (
              <li key={c.cohort_id}>
                <b>{c.name}</b> not assessable — {c.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="disclosure audit-sec">
        <summary>Provenance</summary>
        <p className="small">{a.provenance.note}</p>
        <p className="xs muted">
          Distinct clinical references behind the {a.cohorts.length} fired patterns: {ix.firedCitations.length}.
        </p>
      </details>

      <RawJson analysis={a} />
    </div>
  );
}
