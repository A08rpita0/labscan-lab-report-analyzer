import { useState } from "react";

import type { Analysis, DiseaseRisk } from "../../api/types";
import { score } from "../../lib/format";
import { ROLE_WORD, TIER_WORD, URGENCY_WORD, word } from "../../lib/labels";
import { EmptyState, EvidenceLevelTag, Icon } from "../ui";


/* Disease Master columns shown verbatim, in the workbook's own order and wording. */
const GROUPS: [string, string[]][] = [
  ["Overview", ["Definition", "Synonyms / AKA", "Common Symptoms"]],
  ["Laboratory picture", ["Related Markers/Tests", "High-Risk Indicators", "Confirmatory/Diagnostic Tests"]],
  ["Course", ["Severity/Urgency Level", "Prognosis / Typical Course", "Possible Complications"]],
  ["Risk factors", ["External Risk Factors", "Genetic/Family History Factors", "Other Important Factors"]],
  ["Differentials and guidance", ["Differential Diagnoses", "Prevention/Lifestyle Guidance", "Recommended Next Step"]],
];

function Entry({ r }: { r: DiseaseRisk }) {
  const [open, setOpen] = useState(false);
  const f = r.dm_fields;
  return (
    <article className={`ref-entry${open ? " is-open" : ""}`}>
      <button type="button" className="ref-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="finding-chev" aria-hidden="true" />
        <span className="ref-title">
          <span className="ref-name">{r.name}</span>
          {r.display_name && r.display_name !== r.name && <span className="xs muted">presented as “{r.display_name}”</span>}
        </span>
        <span className="ref-meta">
          {r.icd10 && <span className="badge badge-mono">ICD-10 {r.icd10}</span>}
          <span className="badge">{r.classification}</span>
          <EvidenceLevelTag level={r.evidence_level} compact />
        </span>
      </button>
      {open && (
        <div className="ref-body fade-in">
          <dl className="ref-facts">
            <div>
              <dt>Profile(s)</dt>
              <dd>{f["Related Profile(s)"] ?? r.profiles.join(", ")}</dd>
            </div>
            <div>
              <dt>Signal tier</dt>
              <dd>{TIER_WORD[r.presentation_tier]}</dd>
            </div>
            <div>
              <dt>Urgency tier</dt>
              <dd>{word(URGENCY_WORD, r.urgency_tier)}</dd>
            </div>
            <div>
              <dt>Review status</dt>
              <dd>{f["Review Status"] ?? r.review_status ?? "—"}</dd>
            </div>
          </dl>

          {GROUPS.map(([title, keys]) => {
            const present = keys.filter((k) => f[k]);
            if (!present.length) return null;
            return (
              <section key={title} className="ref-group">
                <h4 className="fb-h">{title}</h4>
                <dl className="kv ref-kv">
                  {present.map((k) => (
                    <div key={k} className="ref-pair">
                      <dt>{k}</dt>
                      <dd>{f[k]}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}

          <section className="ref-group">
            <h4 className="fb-h">How this mapping works</h4>
            <p className="small muted">
              The engine never raises a Disease Master row directly. A configured pattern rule fires on laboratory values, and each pattern links to rows with a weight and a role.
              Every link must quote the Disease Master text that justifies it, or the engine refuses to start.
            </p>
            <ul className="ref-links small">
              {r.contributions.map((c) => (
                <li key={c.cohort_id}>
                  <b>{c.cohort_name}</b> → {word(ROLE_WORD, c.role).toLowerCase()}, weight {score(c.link_weight)}, contribution {score(c.contribution, 3)}
                  <div className="tr-quote">{c.dm_basis}</div>
                </li>
              ))}
            </ul>
          </section>

          <details className="disclosure">
            <summary>View technical evidence</summary>
            <pre className="code-block">{JSON.stringify(r.score_breakdown, null, 2)}</pre>
          </details>

          <p className="xs muted ref-src">
            Source / reference (as recorded in the workbook): {f["Source / Reference"] ?? "not stated"}
            {f["Last Updated"] ? ` · last updated ${f["Last Updated"]}` : ""}
          </p>
        </div>
      )}
    </article>
  );
}

export function ClinicalReference({ analysis: a }: { analysis: Analysis }) {
  if (!a.disease_risks.length) {
    return <EmptyState icon="book" title="No Disease Master rows were linked by this analysis." />;
  }
  const supported = a.disease_risks.filter((r) => r.presentation_tier !== "insufficient");
  const rest = a.disease_risks.filter((r) => r.presentation_tier === "insufficient");
  const unsourced = a.disease_risks.filter((r) => /not yet sourced/i.test(r.dm_fields["Source / Reference"] ?? "")).length;

  return (
    <div className="reference">
      {unsourced > 0 && (
        <div className="callout callout-warn">
          <Icon name="info" />
          <div className="small">
            {unsourced} of these {a.disease_risks.length} Disease Master rows record their source as “not yet sourced” in the workbook; all are pending clinical review. The pattern rules that
            reach them carry their own clinical citations, shown on each finding.
          </div>
        </div>
      )}
      <div className="ref-list">
        {supported.map((r) => (
          <Entry key={r.disease_id} r={r} />
        ))}
      </div>
      {rest.length > 0 && (
        <details className="disclosure ref-rest">
          <summary>Rows considered but not supported ({rest.length})</summary>
          <div className="ref-list">
            {rest.map((r) => (
              <Entry key={r.disease_id} r={r} />
            ))}
          </div>
        </details>
      )}
      <p className="xs muted">
        {a.disease_risks.length} of the {a.provenance.disease_master_rows} rows in {a.provenance.disease_master_source}, listed under their Disease Master names. A finding may be
        presented under a narrower name when the evidence supports only a risk signal, not the condition itself.
      </p>
    </div>
  );
}
