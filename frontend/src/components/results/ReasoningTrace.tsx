import type { ReasoningTrace as Trace, TraceStep } from "../../api/types";
import { num, refText, score } from "../../lib/format";
import { BASIS_WORD, PRIORITY_WORD, ROLE_WORD, TRACE_WORD, word } from "../../lib/labels";

/* The reasoning trail for one signal, stage by stage, exactly as the engine recorded it:
 *
 *   input -> normalization -> abnormality -> pattern rule -> Disease Master mapping
 *         -> evidence aggregation -> action mapping
 *
 * Every value shown is read from the trace the backend built (engine/explain.py); this
 * component only lays it out. */

function Row({ children }: { children: React.ReactNode }) {
  return <li className="tr-row">{children}</li>;
}

function StepBody({ step }: { step: TraceStep }) {
  const items = step.items ?? [];
  switch (step.stage) {
    case "input":
      return (
        <ul className="tr-rows">
          {items.map((i) => (
            <Row key={i.parameter_id}>
              {i.derived ? (
                <>
                  <span className="tr-k">calculated</span>
                  <span>
                    {i.derivation || "derived value"}
                    {i.derived_from?.length && !String(i.derivation ?? "").includes(" from ") ? (
                      <span className="muted"> from {i.derived_from.join(", ")}</span>
                    ) : null}
                  </span>
                </>
              ) : (
                <>
                  <span className="tr-k mono">“{String(i.raw_name)}”</span>
                  <span>
                    <b className="num">
                      {String(i.raw_value)}
                      {i.raw_unit ? ` ${i.raw_unit}` : ""}
                    </b>
                    {i.raw_range && <span className="muted"> · printed range {i.raw_range}</span>}
                    {i.raw_flag && <span className="muted"> · flag “{i.raw_flag}”</span>}
                    <span className="tr-src mono"> {i.source_kind}{i.source_path ? ` ${i.source_path}` : ""}</span>
                  </span>
                </>
              )}
            </Row>
          ))}
        </ul>
      );
    case "normalization":
      return (
        <ul className="tr-rows">
          {items.map((i) => (
            <Row key={i.parameter_id}>
              <span className="tr-k">{i.name}</span>
              <span>
                <b className="num">
                  {num(i.value)}
                  {typeof i.value === "number" && i.unit ? ` ${i.unit}` : ""}
                </b>
                <span className="muted">
                  {" "}
                  · reference {refText(i.reference_low, i.reference_high) ?? "none"} ({i.reference_source})
                </span>
                {i.conversion_note && <span className="tr-note"> {i.conversion_note}</span>}
              </span>
            </Row>
          ))}
        </ul>
      );
    case "abnormality":
      return (
        <ul className="tr-rows">
          {items.map((i) => (
            <Row key={i.parameter_id}>
              <span className="tr-k">{i.name}</span>
              <span>
                {i.abnormal ? <b>{i.grade_label || i.grade}</b> : i.in_range_but_triggered ? <b>Within range, but meets a rule threshold</b> : <b>Within range</b>}
                <span className="muted"> · {word(BASIS_WORD, i.finding_basis)} · severity {score(i.severity_score)}</span>
                {i.data_quality === "suspicious" && <span className="tr-warn"> · flagged for checking: {i.data_quality_reason}</span>}
              </span>
            </Row>
          ))}
        </ul>
      );
    case "pattern":
      return (
        <ul className="tr-rows">
          {items.map((c) => (
            <Row key={c.cohort_id}>
              <span className="tr-k">{c.name}</span>
              <span>
                confidence <b className="num">{score(c.confidence)}</b> · coverage {Math.round(c.data_coverage * 100)}% ·{" "}
                {c.mode === "count_of" ? `${c.components_met.length} criteria met` : "weighted triggers"}
                <ul className="tr-sub">
                  {c.matched.map((m: any) => (
                    <li key={m.parameter_id + m.rule}>
                      <span className="mono xs">{score(m.effective_weight)}</span> {m.parameter}: {m.rule || "matched"}{" "}
                      <span className="muted">({word(ROLE_WORD, m.role)}{m.discounted ? `; discounted — ${m.discounted}` : ""})</span>
                    </li>
                  ))}
                </ul>
                {c.citations?.length > 0 && <div className="xs muted">Cited: {c.citations.join("; ")}</div>}
              </span>
            </Row>
          ))}
        </ul>
      );
    case "mapping":
      return (
        <ul className="tr-rows">
          {items.map((m) => (
            <Row key={m.cohort_id}>
              <span className="tr-k">{m.cohort_name}</span>
              <span>
                <span className="mono small">
                  {score(m.link_weight)} link × {score(m.cohort_confidence)} confidence × {score(m.role_factor)} {word(ROLE_WORD, m.role).toLowerCase()}
                  {m.support_penalty !== 1 ? ` × ${score(m.support_penalty)} damping` : ""} = <b>{score(m.contribution, 3)}</b>
                </span>
                <div className="tr-quote">{m.dm_basis}</div>
                {m.support_note && <div className="xs tr-warn">{m.support_note}</div>}
              </span>
            </Row>
          ))}
        </ul>
      );
    case "aggregation": {
      const d = step.data ?? {};
      return (
        <div className="tr-agg">
          <div className="mono small">
            score = {d.formula} = <b>{score(d.score, 3)}</b>
          </div>
          <div className="small">
            Band from score: <b>{d.band_from_score}</b> · data coverage {Math.round((d.coverage ?? 0) * 100)}%
            {d.cap_applied ? (
              <>
                {" "}
                · cap: <b>{d.cap_applied}</b>
              </>
            ) : (
              " · no cap applied"
            )}{" "}
            → final level <b>{d.final_level}</b>
          </div>
          {d.direct_evidence && (
            <div className="small">
              Direct criterion: {d.direct_evidence.parameter} {d.direct_evidence.observed}. {d.direct_evidence.statement}
              {d.direct_evidence.threshold_source && <span className="muted"> ({d.direct_evidence.threshold_source})</span>}
            </div>
          )}
        </div>
      );
    }
    case "recommendation":
      return items.length ? (
        <ul className="tr-rows">
          {items.map((a) => (
            <Row key={a.id}>
              <span className="tr-k">{word(PRIORITY_WORD, a.priority)}</span>
              <span>
                {a.text} <span className="muted xs">({word(TRACE_WORD, a.trace)})</span>
              </span>
            </Row>
          ))}
        </ul>
      ) : null;
    default:
      return null;
  }
}

export function ReasoningTrace({ trace }: { trace: Trace }) {
  return (
    <ol className="trace" aria-label={`Reasoning trace for ${trace.display_name}`}>
      {trace.steps.map((s, i) => (
        <li key={s.stage} className={`trace-step ts-${s.stage}`}>
          <span className="trace-dot" aria-hidden="true">
            {i + 1}
          </span>
          <div className="trace-content">
            <div className="trace-head">
              <span className="trace-title">{s.title}</span>
              <span className="trace-summary small muted">{s.summary}</span>
            </div>
            <StepBody step={s} />
          </div>
        </li>
      ))}
    </ol>
  );
}
