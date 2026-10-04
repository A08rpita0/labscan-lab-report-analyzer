import { useMemo, useState } from "react";

import type { Analysis, Parameter } from "../../api/types";
import { DEFAULT_QUERY, filterParameters, profilesOf, statusOf, type ExplorerQuery } from "../../lib/explorer";
import { num, rangePosition, refText, repeats, score } from "../../lib/format";
import { BASIS_WORD, PRIORITY_WORD, ROLE_WORD, word } from "../../lib/labels";
import { useDebounced } from "../../lib/hooks";
import { EmptyState, Icon } from "../ui";
import type { Index } from "./model";

function RangeBar({ p }: { p: Parameter }) {
  const pos = rangePosition(p.value, p.reference_low, p.reference_high);
  if (!pos) {
    const one = refText(p.reference_low, p.reference_high);
    return <span className="rb-none xs muted">{p.kind !== "numeric" ? "qualitative" : one ? `limit ${one}` : "no interval"}</span>;
  }
  const out = p.abnormal;
  return (
    <span className="rangebar" role="img" aria-label={`${num(p.value)} against reference ${refText(p.reference_low, p.reference_high)}`}>
      <span className="rb-track" />
      <span className="rb-band" style={{ left: `${pos.low * 100}%`, width: `${(pos.high - pos.low) * 100}%` }} />
      <span className={`rb-mark${out ? " is-out" : ""}`} style={{ left: `${pos.value * 100}%` }} />
      {pos.offScale && <span className={`rb-off rb-off-${pos.offScale}`}>{pos.offScale === "above" ? "›" : "‹"}</span>}
    </span>
  );
}

function StatusCell({ p }: { p: Parameter }) {
  const s = statusOf(p);
  if (s === "normal") return <span className="status status-normal">Within range</span>;
  if (s === "rule") return <span className="status status-rule">In range · rule met</span>;
  const k = p.direction === "low" ? "low" : p.direction === "high" ? "high" : "positive";
  const generic = k === "positive" ? "Positive" : k === "low" ? "Low" : "High";
  // The value column already shows a qualitative result; never print it twice.
  const label = p.grade_label && !repeats(p.grade_label, p.value ?? p.status ?? p.category) ? p.grade_label : generic;
  return <span className={`status status-${k}`}>{label}</span>;
}

function Detail({ p, ix, analysis, onShowInGraph, onOpenFinding }: {
  p: Parameter;
  ix: Index;
  analysis: Analysis;
  onShowInGraph: (id: string) => void;
  onOpenFinding: (id: string) => void;
}) {
  const links = analysis.explainability.parameter_links[p.parameter_id];
  const actions = (links?.actions ?? []).map((id) => ix.recById.get(id)).filter(Boolean);
  const inGraph = analysis.explainability.graph.nodes.some((n) => n.id === `p:${p.parameter_id}`);

  return (
    <div className="px-detail fade-in">
      <div className="px-dcol">
        <h4 className="fb-h">Why is it graded this way?</h4>
        <dl className="kv">
          <dt>Basis</dt>
          <dd>{word(BASIS_WORD, p.finding_basis)}</dd>
          <dt>Interval used</dt>
          <dd className="num">
            {refText(p.reference_low, p.reference_high) ?? "none"} <span className="muted xs">({p.reference_source})</span>
          </dd>
          <dt>Graded by</dt>
          <dd>{p.graded_by === "decision_band" ? "a configured guideline band" : p.graded_by === "range" ? "the reference interval" : p.graded_by}</dd>
          <dt>Severity</dt>
          <dd className="num">{score(p.severity_score)}</dd>
          {p.printed_band && (<><dt>Printed band</dt><dd>{p.printed_band}</dd></>)}
          {p.conversion_note && (<><dt>Unit conversion</dt><dd>{p.conversion_note}</dd></>)}
          {p.derived && (<><dt>Calculated</dt><dd>{p.derivation}</dd></>)}
          {p.data_quality !== "valid" && (<><dt>Data quality</dt><dd className="warn-text">{p.data_quality_reason}</dd></>)}
        </dl>
        {p.notes.length > 0 && (
          <ul className="xs px-notes">
            {p.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {p.raw && (
          <p className="xs muted mono px-raw">
            read as “{p.raw.raw_name}” = {String(p.raw.raw_value)}
            {p.raw.raw_unit ? ` ${p.raw.raw_unit}` : ""}
            {p.raw.raw_range ? ` (printed ${p.raw.raw_range})` : ""} · {p.raw.source_kind} {p.raw.source_path ?? ""}
          </p>
        )}
      </div>
      <div className="px-dcol">
        <h4 className="fb-h">Which patterns use it?</h4>
        {links?.cohorts.length ? (
          <ul className="px-links small">
            {links.cohorts.map((c) => (
              <li key={c.id}>
                <b>{c.name}</b> <span className="muted xs">· {word(ROLE_WORD, c.role)} · weight {score(c.effective_weight)}{c.discounted ? " (discounted)" : ""}</span>
                {c.rule && <div className="xs muted">{c.rule}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No configured pattern fired on this result.</p>
        )}
        <h4 className="fb-h">Did it contribute to a signal?</h4>
        {links?.conditions.length ? (
          <ul className="px-links small">
            {links.conditions.map((c) => (
              <li key={c.id}>
                <button type="button" className="linkish" onClick={() => onOpenFinding(c.id)}>
                  {c.name}
                </button>{" "}
                <span className="muted xs">via {c.via}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{p.abnormal ? "No — it is listed as a finding in its own right, without a linked condition." : "No."}</p>
        )}
        {actions.length > 0 && (
          <>
            <h4 className="fb-h">Plan steps that quote it</h4>
            <ul className="px-links small">
              {actions.map((r) => (
                <li key={r!.id}>
                  <span className="muted xs">{word(PRIORITY_WORD, r!.priority)} · </span>
                  {r!.text.length > 140 ? r!.text.slice(0, 138) + "…" : r!.text}
                </li>
              ))}
            </ul>
          </>
        )}
        {inGraph && (
          <button type="button" className="btn btn-sm" onClick={() => onShowInGraph(`p:${p.parameter_id}`)}>
            <Icon name="graph" /> Trace in evidence graph
          </button>
        )}
      </div>
    </div>
  );
}

export function ParameterExplorer({ analysis, ix, onShowInGraph, onOpenFinding }: {
  analysis: Analysis;
  ix: Index;
  onShowInGraph: (id: string) => void;
  onOpenFinding: (id: string) => void;
}) {
  const [q, setQ] = useState<ExplorerQuery>(DEFAULT_QUERY);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const text = useDebounced(q.text, 160);
  const profiles = useMemo(() => profilesOf(analysis.parameters), [analysis.parameters]);
  const rows = useMemo(() => filterParameters(analysis.parameters, { ...q, text }, ix.isLinked), [analysis.parameters, q, text, ix]);
  const set = (patch: Partial<ExplorerQuery>) => setQ((prev) => ({ ...prev, ...patch }));
  const counts = useMemo(() => {
    const c = { all: analysis.parameters.length, abnormal: 0, rule: 0, normal: 0 };
    for (const p of analysis.parameters) c[statusOf(p)]++;
    return c;
  }, [analysis.parameters]);

  if (!analysis.parameters.length) {
    return <EmptyState icon="list" title="No results were recognised in this file." />;
  }

  return (
    <div className="px">
      <div className="px-controls">
        <label className="px-search">
          <Icon name="search" />
          <span className="sr-only">Search results</span>
          <input className="input" type="search" placeholder="Search name, profile, unit…" value={q.text} onChange={(e) => set({ text: e.target.value })} />
        </label>
        <div className="segmented" role="group" aria-label="Filter by status">
          {(
            [
              ["all", `All ${counts.all}`],
              ["abnormal", `Outside range ${counts.abnormal}`],
              ["rule", `Rule met in range ${counts.rule}`],
              ["normal", `Within range ${counts.normal}`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={q.status === k} onClick={() => set({ status: k })}>
              {label}
            </button>
          ))}
        </div>
        <select className="select px-select" aria-label="Filter by profile" value={q.profile} onChange={(e) => set({ profile: e.target.value })}>
          <option value="">All profiles</option>
          {profiles.map((p) => (
            <option key={p.profile} value={p.profile}>
              {p.profile} ({p.total})
            </option>
          ))}
        </select>
        <select className="select px-select" aria-label="Filter by link to findings" value={q.link} onChange={(e) => set({ link: e.target.value as ExplorerQuery["link"] })}>
          <option value="all">Any linkage</option>
          <option value="linked">Feeds a pattern or signal</option>
          <option value="unlinked">Feeds nothing</option>
        </select>
        <select className="select px-select" aria-label="Sort" value={q.sort} onChange={(e) => set({ sort: e.target.value as ExplorerQuery["sort"] })}>
          <option value="attention">Sort: needs attention</option>
          <option value="severity">Sort: severity</option>
          <option value="profile">Sort: profile</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      <p className="xs muted px-count" aria-live="polite">
        Showing {rows.length} of {analysis.parameters.length}
        {rows.length > 0 && (
          <>
            {" · "}
            <button type="button" className="linkish" onClick={() => setOpen(new Set(rows.map((r) => r.parameter_id)))}>
              expand all
            </button>{" "}
            /{" "}
            <button type="button" className="linkish" onClick={() => setOpen(new Set())}>
              collapse all
            </button>
          </>
        )}
      </p>

      {rows.length ? (
        <div className="px-table" role="list">
          <div className="px-row px-headrow" aria-hidden="true">
            <span>Parameter</span>
            <span className="r">Value</span>
            <span>Reference position</span>
            <span>Status</span>
            <span>Profile</span>
          </div>
          {rows.map((p) => {
            const isOpen = open.has(p.parameter_id);
            const links = analysis.explainability.parameter_links[p.parameter_id];
            return (
              <div key={p.parameter_id} role="listitem" className={`px-item${isOpen ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="px-row"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen((prev) => {
                      const n = new Set(prev);
                      if (n.has(p.parameter_id)) n.delete(p.parameter_id);
                      else n.add(p.parameter_id);
                      return n;
                    })
                  }
                >
                  <span className="px-name">
                    <span className="finding-chev" aria-hidden="true" />
                    <span>
                      {p.name}
                      {p.derived && <span className="badge badge-outline px-calc">calc</span>}
                      {links?.conditions.length ? <span className="px-linkdot" title="Feeds a signal" /> : null}
                    </span>
                  </span>
                  <span className="r num px-val">
                    {num(p.value ?? p.status ?? p.category)} <span className="muted xs">{p.value !== null ? p.unit ?? "" : ""}</span>
                  </span>
                  <span className="px-range">
                    <RangeBar p={p} />
                    <span className="xs muted num">{refText(p.reference_low, p.reference_high) ?? ""}</span>
                  </span>
                  <span>
                    <StatusCell p={p} />
                  </span>
                  <span className="xs muted px-prof">{p.profile ?? "Other"}</span>
                </button>
                {isOpen && <Detail p={p} ix={ix} analysis={analysis} onShowInGraph={onShowInGraph} onOpenFinding={onOpenFinding} />}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="search" title="No results match these filters.">
          <button type="button" className="linkish" onClick={() => setQ(DEFAULT_QUERY)}>
            Reset filters
          </button>
        </EmptyState>
      )}
    </div>
  );
}
