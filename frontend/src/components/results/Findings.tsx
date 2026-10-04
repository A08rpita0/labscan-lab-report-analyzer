import type { Analysis, DiseaseRisk, LabFinding, Measurement } from "../../api/types";
import { num, pct, refText, repeats, score } from "../../lib/format";
import { BASIS_WORD, PRIORITY_WORD, ROLE_WORD, TIER_HELP, TIER_WORD, URGENCY_WORD, word } from "../../lib/labels";
import { EmptyState, EvidenceLevelTag, Icon, Meter, Tip } from "../ui";
import { riskName, type Index } from "./model";
import { ReasoningTrace } from "./ReasoningTrace";

/* ------------------------------------------------------------------ contribution panel */

/** How a signal's score was built: each pattern's contribution, then the running noisy-OR
 *  total as each is added, drawn against the configured evidence-band thresholds. */
export function ContributionPanel({ risk, scale }: { risk: DiseaseRisk; scale: Analysis["explainability"]["scale"] }) {
  const ceiling = scale.contribution_ceiling;
  let running = 0;
  const steps = risk.contributions.map((c) => {
    const before = running;
    running = 1 - (1 - running) * (1 - Math.min(ceiling, c.contribution));
    return { c, before, after: running };
  });

  return (
    <div className="contrib">
      <ul className="contrib-list">
        {steps.map(({ c }) => (
          <li key={c.cohort_id}>
            <div className="contrib-top">
              <span className="contrib-name">{c.cohort_name}</span>
              <span className="badge badge-outline">{word(ROLE_WORD, c.role)}</span>
              <span className="num contrib-val">{score(c.contribution, 3)}</span>
            </div>
            <div className="contrib-bar" aria-hidden="true">
              <i style={{ width: `${c.contribution * 100}%` }} />
            </div>
            <div className="contrib-formula mono xs">
              {score(c.link_weight)} link weight × {score(c.cohort_confidence)} pattern confidence × {score(scale.role_factor[c.role] ?? 0.5)} role factor
              {c.support_penalty !== 1 ? ` × ${score(c.support_penalty)} support damping` : ""}
            </div>
            {c.support_note && <div className="xs contrib-damp">{c.support_note}</div>}
          </li>
        ))}
      </ul>

      <div className="buildup">
        <div className="buildup-label xs muted">
          Noisy-OR build-up — score = 1 − Π(1 − contribution){" "}
          <Tip>Independent evidence raises the score with diminishing returns, and the total stays in [0, 1]. The score measures configured evidence, not disease probability.</Tip>
        </div>
        <div className="buildup-track" role="img" aria-label={`Combined evidence score ${score(risk.score)}`}>
          {steps.map(({ c, before, after }, i) => (
            <i key={c.cohort_id} className={`bu-seg bu-${i % 4}`} style={{ left: `${before * 100}%`, width: `${(after - before) * 100}%` }} title={`${c.cohort_name}: +${score(after - before, 3)}`} />
          ))}
          {scale.evidence_bands.map((b) => (
            <span key={b.level} className="bu-tick" style={{ left: `${b.min_score * 100}%` }}>
              <span className="bu-tick-l">{b.level}</span>
            </span>
          ))}
          <span className="bu-score" style={{ left: `${risk.score * 100}%` }} />
        </div>
        <div className="buildup-result small">
          Score <b className="num">{score(risk.score)}</b> → band <b>{String(risk.score_breakdown.band_from_score ?? "")}</b>
          {risk.score_breakdown.cap_applied ? (
            <>
              {" "}
              → capped (<span>{String(risk.score_breakdown.cap_applied)}</span>)
            </>
          ) : null}{" "}
          → reported level <b>{risk.evidence_level}</b>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ measurement rows */

function MeasureRow({ m, tone }: { m: Measurement; tone: "for" | "against" | "context" }) {
  return (
    <li className={`mrow mrow-${tone}`}>
      <span className="mrow-name">{m.name}</span>
      <span className="mrow-val num">
        {num(m.value)} {typeof m.value === "number" ? m.unit ?? "" : ""}
      </span>
      <span className="mrow-ref num muted">{refText(m.reference_low, m.reference_high) ?? ""}</span>
      <span className="mrow-read">{m.reading ?? ""}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ finding card */

function FindingCard({ risk: r, analysis, ix, open, toggle, onShowInGraph }: {
  risk: DiseaseRisk;
  analysis: Analysis;
  ix: Index;
  open: boolean;
  toggle: (id: string) => void;
  onShowInGraph: (nodeId: string) => void;
}) {
  const trace = ix.traceById.get(r.disease_id);
  const urgent = ix.urgentIds.has(r.disease_id);
  const recs = ix.recsForRisk(r);
  const cites = [...new Map(r.contributions.flatMap((c) => ix.cohortById.get(c.cohort_id)?.evidence ?? []).map((e) => [e.citation, e])).values()];
  const drivers = r.triggering_parameters.filter((t) => !t.discounted);
  const bodyId = `finding-body-${r.disease_id}`;

  return (
    <article id={`finding-${r.disease_id}`} className={`finding t-${r.presentation_tier}${urgent ? " is-urgent" : ""}${open ? " is-open" : ""}`}>
      <button type="button" className="finding-head" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(r.disease_id)}>
        <span className="finding-chev" aria-hidden="true" />
        <span className="finding-main">
          <span className="finding-kicker">
            <span className={`tier-tag tier-${r.presentation_tier}`}>{TIER_WORD[r.presentation_tier]}</span>
            {urgent && <span className="badge badge-red">Time-critical</span>}
            {r.evidence_capped && <span className="badge badge-amber">Level capped · thin data</span>}
            {r.unconfirmed_reason && <span className="badge badge-amber">Rests on readings to confirm</span>}
          </span>
          <span className="finding-name">{riskName(r)}</span>
          <span className="finding-why small">
            {drivers.length
              ? drivers
                  .slice(0, 3)
                  .map((t) => `${t.name} ${t.observed}`)
                  .join(" · ")
              : r.explanation.slice(0, 140)}
          </span>
        </span>
        <span className="finding-side">
          <EvidenceLevelTag level={r.evidence_level} />
          <span className="finding-cov xs muted">
            <span className="num">{score(r.score)}</span> evidence · <span className="num">{pct(r.data_coverage)}</span> coverage
          </span>
        </span>
      </button>

      {open && (
        <div id={bodyId} className="finding-body fade-in">
          {r.display_name && r.display_name !== r.name && (
            <p className="finding-note small">
              {r.display_note} <span className="muted">Disease Master row: {r.name}.</span>
            </p>
          )}
          <p className="finding-tierhelp xs muted">{TIER_HELP[r.presentation_tier]}</p>

          <div className="fb-grid">
            <div className="fb-col">
              <h4 className="fb-h">Why was this flagged?</h4>
              <p className="small fb-expl">{r.explanation}</p>

              <h4 className="fb-h">What contributed?</h4>
              <ContributionPanel risk={r} scale={analysis.explainability.scale} />
            </div>

            <div className="fb-col">
              <h4 className="fb-h">Results behind it</h4>
              <ul className="mrows">
                {r.triggering_parameters.map((t) => {
                  const p = ix.paramById.get(t.parameter_id);
                  return (
                    <li key={t.parameter_id} className={`mrow mrow-for${t.discounted ? " is-dim" : ""}`}>
                      <span className="mrow-name">{t.name}</span>
                      <span className="mrow-val num">{t.observed}</span>
                      <span className="mrow-ref" />
                      <span className="mrow-read">
                        {t.finding}
                        {t.discounted ? " · counted at reduced weight (same biology as another result)" : ""}
                        {p?.derived ? " · calculated" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {r.contradicting.length > 0 && (
                <>
                  <h4 className="fb-h">What argues against it</h4>
                  <ul className="mrows">
                    {r.contradicting.map((m) => (
                      <MeasureRow key={m.parameter_id} m={m} tone="against" />
                    ))}
                  </ul>
                </>
              )}
              {r.context_values.length > 0 && (
                <>
                  <h4 className="fb-h">Related results within range</h4>
                  <ul className="mrows">
                    {r.context_values.slice(0, 6).map((m) => (
                      <MeasureRow key={m.parameter_id} m={m} tone="context" />
                    ))}
                  </ul>
                </>
              )}

              <h4 className="fb-h">What data is missing?</h4>
              {r.missing_parameters.length ? (
                <p className="small">
                  <Meter value={r.data_coverage} tone="slate" label="Data coverage" />
                  <span className="muted xs">
                    {pct(r.data_coverage)} contribution-weighted coverage of the relevant markers. Not measured:{" "}
                  </span>
                  {r.missing_parameters.map((pid) => ix.name(pid)).join(", ")}.
                </p>
              ) : (
                <p className="small muted">Every marker the contributing patterns expect was measured.</p>
              )}

              <h4 className="fb-h">What would strengthen or settle it?</h4>
              <ul className="small fb-strengthen">
                {trace?.would_strengthen.missing_parameters.length ? (
                  <li>
                    Measuring {trace.would_strengthen.missing_parameters.slice(0, 6).map((m) => m.name).join(", ")} would raise data coverage — and could raise or lower the
                    signal.
                  </li>
                ) : null}
                {r.confirmatory_tests && (
                  <li>
                    Confirmation (Disease Master): <i>{r.confirmatory_tests}</i>
                  </li>
                )}
                {r.contradicting.length > 0 && <li>Measured-normal supporting markers already damp this signal; see above.</li>}
                {r.conditional_urgency && r.conditional_urgency !== r.urgency_tier && (
                  <li>
                    Can escalate to <b>{word(URGENCY_WORD, r.conditional_urgency)}</b>: {r.urgency_escalation ?? r.urgency_raw}
                  </li>
                )}
              </ul>
            </div>
          </div>

          {trace && (
            <details className="disclosure fb-trace" open>
              <summary>Reasoning trace — from raw value to action</summary>
              <ReasoningTrace trace={trace} />
            </details>
          )}

          <div className="fb-foot">
            <div className="fb-evidence">
              <h4 className="fb-h">Clinical references behind the patterns</h4>
              {cites.length ? (
                <ul className="cites xs">
                  {cites.map((c) => (
                    <li key={c.citation}>
                      <b>{c.citation}</b>
                      {c.note && <span className="muted"> — {c.note}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="xs muted">No citations recorded.</p>
              )}
              <p className="xs muted">
                Disease Master: {r.name} · {r.classification}
                {r.icd10 ? ` · ICD-10 ${r.icd10}` : ""} · {r.review_status ?? "review status not stated"}
              </p>
            </div>
            <div className="fb-actions">
              {recs.length > 0 && (
                <div className="xs">
                  <b>{recs.length} linked plan step{recs.length === 1 ? "" : "s"}:</b>{" "}
                  {recs
                    .slice(0, 3)
                    .map((x) => `${word(PRIORITY_WORD, x.priority)} — ${x.category}`)
                    .join("; ")}
                </div>
              )}
              <button type="button" className="btn btn-sm" onClick={() => onShowInGraph(`d:${r.disease_id}`)}>
                <Icon name="graph" /> Show in evidence graph
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ lab findings */

function LabFindingRow({ f, onShowInGraph }: { f: LabFinding; onShowInGraph?: (id: string) => void }) {
  const kind = f.abnormal ? (f.direction === "low" ? "low" : f.direction === "high" ? "high" : "positive") : "rule";
  return (
    <li className="labf">
      <div className="labf-top">
        <span className={`status status-${kind}`}>
          {f.grade_label && !repeats(f.grade_label, f.value) ? f.grade_label : word(BASIS_WORD, f.finding_basis)}
        </span>
        <span className="labf-name">{f.name}</span>
        <span className="num labf-val">
          {num(f.value)} {typeof f.value === "number" ? f.unit ?? "" : ""}
        </span>
        {f.reference_text && <span className="xs muted num">ref {f.reference_text}</span>}
        {f.data_quality === "suspicious" && <span className="badge badge-amber">check reading</span>}
      </div>
      <p className="xs labf-statement">{f.statement}</p>
      <p className="xs muted">
        {f.standalone
          ? "No configured pattern interprets this result; it is listed in its own right, without any diagnosis."
          : `Feeds: ${f.linked.map((l) => l.name).join(" · ")}`}
        {onShowInGraph && f.parameter_id && !f.standalone && (
          <>
            {" "}
            <button type="button" className="linkish" onClick={() => onShowInGraph(`p:${f.parameter_id}`)}>
              show in graph
            </button>
          </>
        )}
      </p>
    </li>
  );
}

/* ------------------------------------------------------------------ section */

export function Findings({ analysis: a, ix, open, toggle, onShowInGraph }: {
  analysis: Analysis;
  ix: Index;
  open: Set<string>;
  toggle: (id: string) => void;
  onShowInGraph: (nodeId: string) => void;
}) {
  const urgencyRank: Record<string, number> = { emergency: 0, specialist: 1, monitoring: 2, routine: 3 };
  const supported = a.disease_risks
    .filter((r) => r.presentation_tier !== "insufficient")
    .sort((x, y) => Number(!ix.urgentIds.has(x.disease_id)) - Number(!ix.urgentIds.has(y.disease_id)) || y.score - x.score || (urgencyRank[x.urgency_tier] ?? 9) - (urgencyRank[y.urgency_tier] ?? 9));
  const insufficient = ix.byTier.insufficient;
  const card = (r: DiseaseRisk) => (
    <FindingCard key={r.disease_id} risk={r} analysis={a} ix={ix} open={open.has(r.disease_id)} toggle={toggle} onShowInGraph={onShowInGraph} />
  );
  const vetoes = a.suppressed_findings.filter((s) => s.disease);

  return (
    <div className="findings">
      {supported.length ? (
        <div className="finding-list">{supported.map(card)}</div>
      ) : (
        <EmptyState icon="check" title="No disease-risk signals were identified from the results available." tone="ok">
          {a.summary.abnormal_count
            ? `${a.summary.abnormal_count} result(s) are outside range, but they do not form any of the configured, cited patterns this engine detects. They are listed below.`
            : "Every recognised result is within its reference range."}
          {insufficient.length > 0 && ` ${insufficient.length} condition(s) were assessed and not supported; see below.`}
        </EmptyState>
      )}

      {a.abnormal_findings.length > 0 && (
        <div className="subsection">
          <h3 className="sub-h">
            Results outside range <span className="num muted">{a.abnormal_findings.length}</span>
            <Tip>Every abnormal result, whether or not a pattern interprets it — the Disease Master is an enrichment, never a filter on what counts.</Tip>
          </h3>
          <ul className="labf-list">
            {a.abnormal_findings.map((f) => (
              <LabFindingRow key={(f.parameter_id ?? f.name) + "a"} f={f} onShowInGraph={onShowInGraph} />
            ))}
          </ul>
        </div>
      )}

      {a.threshold_findings.length > 0 && (
        <div className="subsection">
          <h3 className="sub-h">
            Within the laboratory's range, past a guideline threshold <span className="num muted">{a.threshold_findings.length}</span>
          </h3>
          <ul className="labf-list">
            {a.threshold_findings.map((f) => (
              <LabFindingRow key={(f.parameter_id ?? f.name) + "t"} f={f} onShowInGraph={onShowInGraph} />
            ))}
          </ul>
        </div>
      )}

      {a.lab_noted_findings.length > 0 && (
        <div className="subsection">
          <h3 className="sub-h">
            Marked by the laboratory, not graded abnormal here <span className="num muted">{a.lab_noted_findings.length}</span>
          </h3>
          <ul className="labf-list">
            {a.lab_noted_findings.map((f, i) => (
              <LabFindingRow key={(f.parameter_id ?? f.name) + "n" + i} f={f} />
            ))}
          </ul>
        </div>
      )}

      {insufficient.length > 0 && (
        <div className="subsection">
          <h3 className="sub-h">
            Considered, not supported <span className="num muted">{insufficient.length}</span>
            <Tip>Assessed and kept visible so nothing is silently dropped — but the evidence does not support reporting these as findings.</Tip>
          </h3>
          <div className="finding-list is-compact">{insufficient.map(card)}</div>
        </div>
      )}

      {vetoes.length > 0 && (
        <div className="subsection">
          <h3 className="sub-h">
            Suppressed by an exclusion rule <span className="num muted">{vetoes.length}</span>
          </h3>
          <ul className="veto-list small">
            {vetoes.map((v) => (
              <li key={v.rule_id + v.disease}>
                <b>{v.disease}</b> — {v.user_message || v.reason}{" "}
                <span className="muted xs">
                  ({v.parameter_name} {v.observed}; rule <span className="mono">{v.rule_id}</span>
                  {v.would_have_fired_from?.length ? `; would otherwise have come from ${v.would_have_fired_from.join(", ")}` : ""})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
