import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../../api/client";
import type { ConfigSummary, Health } from "../../api/types";
import { num } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import { ROLE_WORD, word } from "../../lib/labels";
import { EmptyState, Icon } from "../ui";

function Breakdown({ data, total }: { data: Record<string, number>; total: number }) {
  return (
    <ul className="sys-break">
      {Object.entries(data)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => (
          <li key={k}>
            <span className="small">{k}</span>
            <span className="sb-bar" aria-hidden="true">
              <i style={{ width: `${(n / total) * 100}%` }} />
            </span>
            <span className="num xs">
              {n}/{total}
            </span>
          </li>
        ))}
    </ul>
  );
}

function RuleCatalogue({ cohorts }: { cohorts: ConfigSummary["cohorts"] }) {
  const [q, setQ] = useState("");
  const [cross, setCross] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q, 150).toLowerCase();
  const rows = useMemo(
    () =>
      cohorts.filter(
        (c) =>
          (!cross || c.cross_profile) &&
          (!dq || [c.name, c.category, c.description, ...c.profiles_touched, ...c.diseases.map((d) => d.name)].join(" ").toLowerCase().includes(dq)),
      ),
    [cohorts, dq, cross],
  );
  return (
    <div className="catalogue">
      <div className="px-controls">
        <label className="px-search">
          <Icon name="search" />
          <span className="sr-only">Search pattern rules</span>
          <input className="input" type="search" placeholder="Search rules, profiles, conditions…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="switch">
          <input type="checkbox" checked={cross} onChange={(e) => setCross(e.target.checked)} />
          <span>Cross-profile only</span>
        </label>
        <span className="xs muted" aria-live="polite">
          {rows.length} of {cohorts.length}
        </span>
      </div>
      <ul className="cat-list">
        {rows.map((c) => {
          const isOpen = open === c.id;
          return (
            <li key={c.id} className={`cat-item${isOpen ? " is-open" : ""}`}>
              <button type="button" className="cat-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>
                <span className="finding-chev" aria-hidden="true" />
                <span className="cat-name">
                  <b>{c.name}</b>
                  <span className="xs muted">
                    {c.category} · {c.mode === "count_of" ? "count of criteria" : "weighted triggers"} · {c.profiles_touched.join(", ")}
                  </span>
                </span>
                <span className="cat-badges">
                  {c.cross_profile && <span className="badge badge-blue">cross-profile</span>}
                  <span className="badge badge-outline">{c.evidence.length} cited</span>
                  <span className="badge badge-outline">{c.diseases.length} links</span>
                </span>
              </button>
              {isOpen && (
                <div className="cat-body fade-in small">
                  {c.description && <p>{c.description}</p>}
                  {c.cross_profile_rationale && (
                    <p className="muted">
                      <b>Why it crosses profiles:</b> {c.cross_profile_rationale}
                    </p>
                  )}
                  <h4 className="fb-h">Disease Master links</h4>
                  <ul className="ref-links">
                    {c.diseases.map((d) => (
                      <li key={d.name}>
                        <b>{d.name}</b> — {word(ROLE_WORD, d.role).toLowerCase()}, weight {d.weight}
                        <div className="tr-quote">{d.dm_basis}</div>
                      </li>
                    ))}
                  </ul>
                  <h4 className="fb-h">Clinical references</h4>
                  <ul className="cites xs">
                    {c.evidence.map((e) => (
                      <li key={e.citation}>
                        <b>{e.citation}</b>
                        {e.note && <span className="muted"> — {e.note}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="xs muted mono">
                    {c.id} · config/cohorts/{c.source_file} · expects {c.expected_parameters.length} parameters
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SystemReference({ health }: { health: Health | null }) {
  const [cfg, setCfg] = useState<ConfigSummary | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    api.configSummary().then(setCfg, (e: ApiError) => setErr(e));
  }, []);

  if (err) {
    return (
      <div className="container sys">
        <EmptyState icon="alert" title="The configuration summary could not be loaded.">
          {err.message} {err.hint}
        </EmptyState>
      </div>
    );
  }
  if (!cfg) {
    return (
      <div className="container sys" aria-busy="true">
        <div className="skeleton" style={{ height: 120, marginTop: 40 }} />
        <div className="skeleton" style={{ height: 320, marginTop: 16 }} />
      </div>
    );
  }

  const sm = cfg.scoring_model;
  const dm = cfg.disease_master;
  const c = cfg.counts;
  const derived = cfg.parameters.filter((p) => p.derived).length;
  const crossProfile = cfg.cohorts.filter((x) => x.cross_profile).length;
  const citations = new Set(cfg.cohorts.flatMap((x) => x.evidence.map((e) => e.citation))).size;

  return (
    <div className="container sys">
      <header className="sys-head">
        <div>
          <h1>How it works</h1>
          <p className="muted">
            All clinical knowledge lives in versioned JSON configuration, validated at start-up: every parameter reference, disease name, citation and Disease Master basis must resolve,
            or the engine refuses to start. Nothing on this page is hard-coded in the interface — it is read from <span className="mono">/api/config/summary</span>.
          </p>
        </div>
        <dl className="sys-ident mono xs">
          <dt>engine</dt>
          <dd>v{cfg.engine.version}</dd>
          <dt>config</dt>
          <dd>sha256:{cfg.engine.config.sha256}</dd>
          <dt>files</dt>
          <dd>{cfg.engine.config.files}</dd>
          <dt>validation</dt>
          <dd className={cfg.validation.ok ? "ok-text" : "warn-text"}>
            {cfg.validation.ok ? "passed" : "FAILED"} · {cfg.validation.errors} errors · {cfg.validation.warnings} warnings
          </dd>
        </dl>
      </header>

      <section className="plain-how" aria-labelledby="plain-how-title">
        <h2 id="plain-how-title">In plain language</h2>
        <ol className="plain-how-steps">
          <li>
            <b>Reading your report.</b> Each test name, value, unit and normal range is read from the file. Different names for the same test (for example
            “SGPT” and “ALT”) are recognised as one test, and units are converted where needed.
          </li>
          <li>
            <b>Checking each result.</b> Every value is compared with the normal range printed on your report, or with a standard medical range when the report
            gives none.
          </li>
          <li>
            <b>Looking across results.</b> Some results only mean something together — for example, several cholesterol values. The tool checks your results
            against {num(c.cohorts)} known result patterns, each based on published medical guidance, and links them to a reference list of{" "}
            {num(c.diseases)} conditions.
          </li>
          <li>
            <b>Suggesting next steps.</b> Suggestions come from that medical reference and never name a medicine or dose. Your doctor decides what applies to you.
          </li>
        </ol>
        <h3>What the three labels mean</h3>
        <dl className="plain-how-levels">
          <div>
            <dt>
              <span className="lvl lvl-important">Important</span>
            </dt>
            <dd>The result is graded severe or critical — far outside its normal range — or it is behind a finding that needs care the same day.</dd>
          </div>
          <div>
            <dt>
              <span className="lvl lvl-attention">Needs attention</span>
            </dt>
            <dd>The result is outside its normal range, or inside the lab's range but past a level medical guidelines watch for.</dd>
          </div>
          <div>
            <dt>
              <span className="lvl lvl-normal">Normal</span>
            </dt>
            <dd>The result is inside its normal range.</dd>
          </div>
        </dl>
        <p className="muted small">
          Always the same input, always the same answer: there is no guessing and no learning from other people's data. This tool does not diagnose. The medical
          reference it uses is a draft awaiting clinical review.
        </p>
      </section>

      <h2 className="sys-tech-h">Technical reference</h2>
      <p className="muted small sys-lead">The configuration and scoring model behind the plain summary, for doctors and technical reviewers.</p>

      <dl className="facts sys-facts">
        {[
          ["Disease Master rows", c.diseases],
          ["Pattern rules", c.cohorts],
          ["Cross-profile rules", crossProfile],
          ["Cohort → disease links", c.disease_links],
          ["Rows reachable by a rule", c.diseases_linked],
          ["Rows documented as not lab-mappable", c.diseases_intentionally_unmapped],
          ["Canonical parameters", c.parameters],
          ["Calculated parameters", derived],
          ["Parameter aliases", c.aliases],
          ["Distinct clinical citations", citations],
        ].map(([label, v]) => (
          <div key={label as string}>
            <dt>{label}</dt>
            <dd className="num">{num(v)}</dd>
          </div>
        ))}
      </dl>

      <section className="sys-sec" aria-labelledby="sys-scoring">
        <h2 id="sys-scoring">Scoring model</h2>
        <div className="sys-cols">
          <div className="sys-card">
            <h3>1 · Pattern confidence</h3>
            <p className="mono small code-line">{sm.cohort_confidence.weighted}</p>
            <p className="mono small code-line">{sm.cohort_confidence.count_of}</p>
            <p className="mono small code-line">coverage_factor = {sm.cohort_confidence.coverage_factor}</p>
            <p className="mono small code-line">{sm.cohort_confidence.severity_modulation}</p>
            <ul className="small sys-notes">
              {sm.cohort_confidence.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="xs muted mono">{Object.entries(sm.cohort_confidence.constants).map(([k, v]) => `${k}=${v}`).join(" · ")}</p>
          </div>
          <div className="sys-card">
            <h3>2 · Signal score ({sm.condition_score.name})</h3>
            <p className="mono small code-line">{sm.condition_score.contribution}</p>
            <p className="mono small code-line">{sm.condition_score.combination}</p>
            <table className="table sys-roles">
              <thead>
                <tr>
                  <th>Link role</th>
                  <th className="num">Factor</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(sm.condition_score.role_factor).map(([r, f]) => (
                  <tr key={r}>
                    <td>{word(ROLE_WORD, r)}</td>
                    <td className="num">{f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="small sys-notes">
              {sm.condition_score.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <div className="sys-card">
            <h3>3 · Evidence level</h3>
            <div className="scale" role="img" aria-label="Evidence level bands">
              {sm.evidence_levels.bands
                .slice()
                .reverse()
                .map((b, i, arr) => {
                  const hi = i < arr.length - 1 ? arr[i + 1].min_score : 1;
                  return (
                    <span key={b.level} className={`scale-band sb-${b.level}`} style={{ left: `${b.min_score * 100}%`, width: `${(hi - b.min_score) * 100}%` }}>
                      {b.level}
                    </span>
                  );
                })}
              <span className="scale-floor" style={{ width: `${sm.condition_score.reporting_floor * 100}%` }}>
                not reported
              </span>
            </div>
            <p className="xs muted scale-axis mono">
              0 · {sm.evidence_levels.bands.slice().reverse().map((b) => b.min_score).join(" · ")} · 1
            </p>
            <ul className="small sys-notes">
              {sm.evidence_levels.coverage_caps.map((c) => (
                <li key={c.when}>
                  <span className="mono xs">{c.when}</span> → {c.effect}
                </li>
              ))}
              <li>{sm.evidence_levels.direct_exemption}</li>
              <li>{sm.urgency.rule}</li>
            </ul>
          </div>
        </div>
        <div className="sys-card sys-tiers">
          <h3>Presentation tiers</h3>
          <dl className="kv">
            {Object.entries(sm.presentation_tiers).map(([k, v]) => (
              <div key={k} className="ref-pair">
                <dt className="mono">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <h3>Analysis modes</h3>
          <dl className="kv">
            {Object.entries(cfg.analysis_modes).map(([k, v]) => (
              <div key={k} className="ref-pair">
                <dt className="mono">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="sys-sec" aria-labelledby="sys-dm">
        <h2 id="sys-dm">Disease Master</h2>
        <div className="sys-cols">
          <div className="sys-card">
            <h3>Source</h3>
            <dl className="kv">
              <dt>Workbook</dt>
              <dd>
                {dm.source_file} · sheet “{dm.sheet}”
              </dd>
              <dt>Columns kept verbatim</dt>
              <dd>{dm.columns.length}</dd>
              <dt>Rows</dt>
              <dd>
                {dm.disease_count}
                {dm.skipped_rows?.length ? ` (${dm.skipped_rows.length} annotation row skipped)` : ""}
              </dd>
              <dt>Last updated</dt>
              <dd>{cfg.engine.config.disease_master_last_updated}</dd>
            </dl>
            <p className="xs muted sys-prov">{dm.provenance_note}</p>
          </div>
          <div className="sys-card">
            <h3>Review status</h3>
            <Breakdown data={dm.review_status} total={dm.disease_count} />
            <h3>Urgency tier</h3>
            <Breakdown data={dm.urgency_tiers} total={dm.disease_count} />
            <h3>Classification</h3>
            <Breakdown data={dm.classification} total={dm.disease_count} />
          </div>
          <div className="sys-card">
            <h3>Not lab-mappable ({cfg.unmappable.conditions.length})</h3>
            <p className="xs muted">Rows the engine deliberately never raises, with the reason drawn from the row's own fields — so mapping coverage is measured honestly.</p>
            <ul className="small sys-unmap">
              {cfg.unmappable.conditions.map((u) => (
                <li key={u.name}>
                  <b>{u.name}</b>
                  <div className="xs muted">{u.would_need}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="sys-sec" aria-labelledby="sys-rules">
        <h2 id="sys-rules">Pattern rule catalogue</h2>
        <p className="muted small sys-lead">
          {cfg.cohorts.length} cohort rules, each with trigger conditions, expected parameters, cited clinical references and weighted links into the Disease Master.
        </p>
        <RuleCatalogue cohorts={cfg.cohorts} />
      </section>

      <section className="sys-sec" aria-labelledby="sys-excl">
        <h2 id="sys-excl">Hard exclusion rules</h2>
        <p className="muted small sys-lead">An explicitly negative definitive marker suppresses a condition outright. A missing test never does — unknown is not negative.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Marker</th>
                <th>Suppresses</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {cfg.exclusion_rules.map((r) => (
                <tr key={r.id}>
                  <td className="mono xs">{r.id}</td>
                  <td className="mono xs">{r.parameter}</td>
                  <td className="small">{r.vetoes_diseases.join(", ")}</td>
                  <td className="small">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {health && (
        <p className="xs muted sys-foot mono">
          Live health: {health.status} · max upload {health.limits.max_upload_mb} MB · analysis timeout {health.limits.analysis_timeout_s} s · formats{" "}
          {health.limits.accepted_formats.join(", ")}
        </p>
      )}
    </div>
  );
}
