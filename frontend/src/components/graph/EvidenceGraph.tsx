import { useEffect, useMemo, useRef, useState } from "react";

import type { Analysis, GraphEdge, GraphNode } from "../../api/types";
import { num, pct, refText, score } from "../../lib/format";
import { lineage, edgeInLineage, layoutGraph, type PlacedNode } from "../../lib/graphLayout";
import { useElementWidth } from "../../lib/hooks";
import { BASIS_WORD, EDGE_WORD, PRIORITY_WORD, ROLE_WORD, TIER_WORD, TRACE_WORD, URGENCY_WORD, word } from "../../lib/labels";
import { EmptyState, EvidenceLevelTag, Icon, Meter } from "../ui";

const COLUMN_TITLES = ["Laboratory parameters", "Patterns (cohort rules)", "Risk signals", "Action plan"];
const COLUMN_HELP = [
  "results that carried weight in a rule",
  "configured, cited pattern rules that fired",
  "Disease Master rows, evidence pooled",
  "steps linked to their evidence",
];

function nodeSub(n: GraphNode): string {
  switch (n.type) {
    case "parameter":
      return `${num(n.value)}${n.unit && typeof n.value === "number" ? " " + n.unit : ""}${n.grade_label ? " · " + n.grade_label : ""}`;
    case "cohort":
      return `confidence ${score(n.confidence)} · coverage ${pct(n.data_coverage)}`;
    case "condition":
      return `${n.evidence_level} · score ${score(n.score)}`;
    default:
      // the step's subject; the node's own label is the action itself
      return `${word(PRIORITY_WORD, n.priority)} · ${n.label}`;
  }
}

/** A plan step is named by what it asks for, not by the condition it is about: three
 *  steps for one condition otherwise looked like three copies of that condition. */
function nodeTitle(n: GraphNode): string {
  return n.type === "action" && n.text ? n.text : n.label;
}

function nodeMarker(n: GraphNode): string {
  if (n.type === "parameter") return n.abnormal ? (n.direction === "low" ? "low" : n.direction === "high" ? "high" : "positive") : "rule";
  if (n.type === "condition") return n.urgency_tier === "emergency" ? "urgent" : n.tier ?? "pattern";
  if (n.type === "action") return n.priority ?? "low";
  return n.cross_profile ? "cross" : "single";
}

export function EvidenceGraph({ analysis, focus, setFocus, onOpenFinding }: {
  analysis: Analysis;
  focus: string | null;
  setFocus: (id: string | null) => void;
  onOpenFinding: (diseaseId: string) => void;
}) {
  const graph = analysis.explainability.graph;
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>();
  const [showActions, setShowActions] = useState(true);
  const [showInsufficient, setShowInsufficient] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<GraphEdge | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(
    () => layoutGraph(graph, { width: Math.max(wrapWidth - 32, 760), showActions, showInsufficient }),
    [graph, wrapWidth, showActions, showInsufficient],
  );
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  // A focus set elsewhere (results explorer, a finding card) may point at a node that is
  // hidden by the current toggles; reveal it rather than silently showing nothing.
  useEffect(() => {
    if (!focus) return;
    const n = graph.nodes.find((x) => x.id === focus);
    if (n?.type === "condition" && n.tier === "insufficient") setShowInsufficient(true);
    if (n?.type === "action") setShowActions(true);
  }, [focus, graph.nodes]);

  useEffect(() => {
    if (!focus) return;
    const n = byId.get(focus);
    const sc = scrollRef.current;
    if (n && sc) {
      sc.scrollTo({ left: Math.max(0, n.x - 40), top: Math.max(0, n.y - sc.clientHeight / 2 + n.h / 2), behavior: "smooth" });
    }
  }, [focus, byId]);

  const active = hover ?? focus;
  const lit = useMemo(() => (active && byId.has(active) ? lineage(layout.edges, active) : null), [active, layout.edges, byId]);

  if (!graph.nodes.length) {
    return (
      <EmptyState icon="graph" title="No evidence relationships to draw for this report.">
        No pattern rule fired, so no laboratory value was mapped to a Disease Master signal.
        {analysis.summary.abnormal_count > 0
          ? ` ${analysis.summary.abnormal_count} result(s) are outside range; they are listed under What we found and in the results explorer.`
          : " Every recognised result was within range."}
      </EmptyState>
    );
  }

  const selected = focus ? byId.get(focus) ?? null : null;
  const stats = graph.stats;
  const counts = layout.nodes.reduce<Record<string, number>>((m, n) => ((m[n.type] = (m[n.type] ?? 0) + 1), m), {});

  return (
    <div className="eg" onKeyDown={(e) => e.key === "Escape" && setFocus(null)}>
      <div className="eg-toolbar">
        <div className="eg-toggles">
          <label className="switch">
            <input type="checkbox" checked={showActions} onChange={(e) => setShowActions(e.target.checked)} />
            <span>Plan steps</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={showInsufficient} onChange={(e) => setShowInsufficient(e.target.checked)} />
            <span>Unsupported signals{stats.nodes.condition ? ` (${graph.nodes.filter((n) => n.tier === "insufficient").length})` : ""}</span>
          </label>
          {focus && (
            <button type="button" className="btn btn-sm" onClick={() => setFocus(null)}>
              <Icon name="x" /> Clear selection
            </button>
          )}
        </div>
        <ul className="eg-legend" aria-label="Legend">
          <li>
            <i className="lg-edge lg-solid" /> defining trigger / mapping
          </li>
          <li>
            <i className="lg-edge lg-dashed" /> supporting signal
          </li>
          <li>
            <i className="lg-edge lg-dotted" /> plan-step link
          </li>
          <li>
            <i className="lg-edge lg-thick" /> thicker = larger weight or contribution
          </li>
        </ul>
      </div>

      <p className="eg-hint xs muted">
        <Icon name="graph" className="icon icon-xs" /> Select a node to pin its lineage — the values that fired it, what it contributed to, and the plan steps that
        followed. Hover to preview; Esc clears.
      </p>
      <div className="eg-body">
        <div className="eg-canvas-wrap" ref={wrapRef}>
          <div className="eg-scroll" ref={scrollRef} tabIndex={-1}>
            <div className="eg-canvas" style={{ width: layout.width, height: layout.height }}>
              {layout.columnX.map((x, c) => (
                <div key={c} className="eg-colhead" style={{ left: x, width: layout.nodeWidth }}>
                  <span className="eg-colhead-t">{COLUMN_TITLES[c]}</span>
                  <span className="eg-colhead-h">{COLUMN_HELP[c]}</span>
                </div>
              ))}
              <svg className="eg-edges" width={layout.width} height={layout.height} aria-hidden="true">
                {layout.edges.map((e) => {
                  const on = lit ? edgeInLineage(e, lit) : false;
                  const style = e.target.startsWith("a:") ? "dotted" : e.kind === "supporting" ? "dashed" : e.kind === "direct_criterion" ? "direct" : "solid";
                  return (
                    <path
                      key={e.id}
                      d={e.path}
                      className={`eg-edge e-${style}${lit ? (on ? " is-lit" : " is-dim") : ""}${e.discounted ? " is-discounted" : ""}`}
                      strokeWidth={e.strokeWidth}
                      onMouseEnter={() => setHoverEdge(e)}
                      onMouseLeave={() => setHoverEdge(null)}
                    />
                  );
                })}
              </svg>
              {layout.nodes.map((n) => {
                const on = lit ? lit.has(n.id) : false;
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`eg-node n-${n.type} m-${nodeMarker(n)}${focus === n.id ? " is-selected" : ""}${lit ? (on ? " is-lit" : " is-dim") : ""}`}
                    style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(n.id)}
                    onBlur={() => setHover(null)}
                    onClick={() => setFocus(focus === n.id ? null : n.id)}
                    aria-pressed={focus === n.id}
                    title={nodeTitle(n)}
                    aria-label={`${n.type}: ${nodeTitle(n)}. ${nodeSub(n)}`}
                  >
                    <span className="eg-node-label">{nodeTitle(n)}</span>
                    <span className="eg-node-sub">{nodeSub(n)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="eg-foot xs muted">
            {counts.parameter ?? 0} parameters · {counts.cohort ?? 0} patterns · {counts.condition ?? 0} signals
            {showActions ? ` · ${counts.action ?? 0} plan steps` : ""} · {layout.edges.length} relationships drawn.
            {stats.abnormal_parameters_not_in_graph > 0 &&
              ` ${stats.abnormal_parameters_not_in_graph} abnormal result(s) feed no pattern and are listed under What we found.`}
            {showActions &&
              stats.actions_without_evidence_link > 0 &&
              ` ${stats.actions_without_evidence_link} general plan step(s) have no evidence to draw and appear only in the action plan.`}
          </p>
          {hoverEdge && <EdgeDetail e={hoverEdge} byId={byId} />}
        </div>
        <aside
          className={`eg-inspector ${selected ? "has-node" : "is-empty"} side-${selected && selected.col >= 2 ? "left" : "right"}`}
          aria-live="polite"
          aria-label="Selected node details"
        >
          {selected ? (
            <>
              <button type="button" className="btn btn-sm btn-ghost eg-close" aria-label="Close details" onClick={() => setFocus(null)}>
                <Icon name="x" />
              </button>
              <Inspector node={selected} analysis={analysis} edges={layout.edges} byId={byId} onOpenFinding={onOpenFinding} onSelect={setFocus} />
            </>
          ) : (
            <div className="eg-empty small muted">
              <Icon name="graph" />
              <p>
                <b>Nothing selected.</b> Choose any parameter, pattern, signal or plan step to see its values, its rule and every relationship it takes part in.
              </p>
            </div>
          )}
        </aside>

      </div>
    </div>
  );
}

function EdgeDetail({ e, byId }: { e: GraphEdge; byId: Map<string, PlacedNode> }) {
  const s = byId.get(e.source);
  const t = byId.get(e.target);
  return (
    <div className="edge-detail small">
      <div className="insp-label">Relationship</div>
      <p>
        <b>{s?.label}</b> {word(EDGE_WORD, e.kind)} <b>{t?.label}</b>
      </p>
      {e.rule && <p className="muted">Rule: {e.rule}</p>}
      {e.contribution !== undefined && (
        <p className="mono xs">
          {score(e.link_weight)} × {score(e.cohort_confidence)} × {score(e.role_factor)}
          {e.support_penalty !== 1 ? ` × ${score(e.support_penalty)}` : ""} = {score(e.contribution, 3)}
        </p>
      )}
      <p className="mono xs muted">source: {e.basis}</p>
    </div>
  );
}

function Inspector({ node: n, analysis, edges, byId, onOpenFinding, onSelect }: {
  node: PlacedNode;
  analysis: Analysis;
  edges: GraphEdge[];
  byId: Map<string, PlacedNode>;
  onOpenFinding: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const incoming = edges.filter((e) => e.target === n.id);
  const outgoing = edges.filter((e) => e.source === n.id);
  const link = (id: string) => {
    const m = byId.get(id);
    return m ? (
      <button type="button" className="linkish" onClick={() => onSelect(id)}>
        {m.label}
      </button>
    ) : null;
  };

  return (
    <div className="insp fade-in" key={n.id}>
      <div className={`insp-kind k-${n.type}`}>
        {n.type === "parameter" ? "Laboratory parameter" : n.type === "cohort" ? "Pattern rule" : n.type === "condition" ? "Risk signal" : "Plan step"}
      </div>
      <h3 className="insp-title">{n.label}</h3>

      {n.type === "parameter" && (
        <>
          <dl className="kv">
            <dt>Value</dt>
            <dd className="num">
              {num(n.value)} {typeof n.value === "number" ? n.unit : ""}
            </dd>
            <dt>Reference</dt>
            <dd className="num">{refText(n.reference_low ?? null, n.reference_high ?? null) ?? "—"} <span className="muted xs">({n.reference_source})</span></dd>
            <dt>Reading</dt>
            <dd>{n.grade_label ?? "—"}</dd>
            <dt>Basis</dt>
            <dd>{word(BASIS_WORD, n.finding_basis)}</dd>
            <dt>Profile</dt>
            <dd>{n.profile ?? "—"}</dd>
            {n.derived && (<><dt>Origin</dt><dd>Calculated by the engine</dd></>)}
            {n.data_quality === "suspicious" && (<><dt>Data quality</dt><dd className="warn-text">Flagged for checking</dd></>)}
          </dl>
          <InspList title="Fires patterns" items={outgoing.filter((e) => e.target.startsWith("c:"))} render={(e) => (
            <>
              {link(e.target)} <span className="muted xs">· {word(ROLE_WORD, e.kind)} · weight {score(e.effective_weight)}{e.discounted ? " (discounted)" : ""}</span>
              {e.rule && <div className="xs muted">{e.rule}</div>}
            </>
          )} />
          <InspList title="Direct criterion for" items={outgoing.filter((e) => e.kind === "direct_criterion")} render={(e) => link(e.target)} />
          <InspList title="Quoted by plan steps" items={outgoing.filter((e) => e.target.startsWith("a:"))} render={(e) => link(e.target)} />
        </>
      )}

      {n.type === "cohort" && (
        <>
          <div className="insp-meter">
            <span className="xs muted">Pattern confidence</span>
            <Meter value={n.confidence ?? 0} label="Pattern confidence" />
            <span className="num small">{score(n.confidence)}</span>
          </div>
          <dl className="kv">
            <dt>Data coverage</dt>
            <dd>
              {n.parameters_observed} of {n.parameters_expected} expected parameters measured
            </dd>
            <dt>Mode</dt>
            <dd>{n.mode === "count_of" ? "Count of criteria" : "Weighted triggers"}</dd>
            <dt>Profiles</dt>
            <dd>{(n.profiles ?? []).join(", ")}{n.cross_profile ? " · cross-profile" : ""}</dd>
            <dt>Citations</dt>
            <dd>{n.citations} clinical reference(s)</dd>
          </dl>
          <InspList title="Matched by" items={incoming} render={(e) => (
            <>
              {link(e.source)} <span className="muted xs">· {word(ROLE_WORD, e.kind)} · {score(e.effective_weight)}</span>
              <div className="xs muted">{e.observed}</div>
            </>
          )} />
          <InspList title="Contributes to" items={outgoing.filter((e) => e.target.startsWith("d:"))} render={(e) => (
            <>
              {link(e.target)}
              <div className="mono xs">
                {score(e.link_weight)} link × {score(e.cohort_confidence)} conf × {score(e.role_factor)} {e.role}
                {e.support_penalty !== 1 ? ` × ${score(e.support_penalty)} damping` : ""} = <b>{score(e.contribution, 3)}</b>
              </div>
              <div className="xs muted">{e.dm_basis}</div>
            </>
          )} />
        </>
      )}

      {n.type === "condition" && (
        <>
          <div className="insp-row">
            <span className="badge">{TIER_WORD[n.tier ?? "pattern"]}</span>
            {n.evidence_level && <EvidenceLevelTag level={n.evidence_level} />}
          </div>
          <dl className="kv">
            <dt>Evidence score</dt>
            <dd className="num">{score(n.score)}</dd>
            <dt>Data coverage</dt>
            <dd className="num">{pct(n.data_coverage)}{n.capped ? " · level capped" : ""}</dd>
            <dt>Urgency tier</dt>
            <dd>{word(URGENCY_WORD, n.urgency_tier)}</dd>
            <dt>Disease Master row</dt>
            <dd>{n.dm_name}{n.icd10 ? ` · ICD-10 ${n.icd10}` : ""}</dd>
          </dl>
          <InspList title="Evidence pooled (noisy-OR)" items={incoming} render={(e) => (
            <>
              {link(e.source)}{" "}
              {e.contribution !== undefined ? <span className="num xs">+{score(e.contribution, 3)}</span> : <span className="xs muted">{word(EDGE_WORD, e.kind)}</span>}
            </>
          )} />
          <button type="button" className="btn btn-sm btn-accent insp-cta" onClick={() => onOpenFinding(n.ref)}>
            Open reasoning trace
          </button>
        </>
      )}

      {n.type === "action" && (
        <>
          <div className="insp-row">
            <span className={`badge prio-badge prio-${n.priority}`}>{word(PRIORITY_WORD, n.priority)}</span>
            <span className="badge badge-outline">{n.category}</span>
          </div>
          <p className="small insp-text">{n.text}</p>
          <dl className="kv">
            <dt>Produced by</dt>
            <dd>{word(TRACE_WORD, n.trace)}</dd>
            {n.timeframe && (<><dt>Timeframe</dt><dd>{n.timeframe}</dd></>)}
          </dl>
          <InspList title="Linked evidence" items={incoming} render={(e) => (
            <>
              {link(e.source)} <span className="muted xs">· {word(EDGE_WORD, e.kind)}</span>
            </>
          )} />
          <p className="xs muted">Engine-generated suggestion. A clinician decides whether it applies.</p>
        </>
      )}
      <p className="xs muted insp-src mono">
        node {n.id} · from analysis {analysis.engine.config.sha256}
      </p>
    </div>
  );
}

function InspList({ title, items, render }: { title: string; items: GraphEdge[]; render: (e: GraphEdge) => React.ReactNode }) {
  if (!items.length) return null;
  return (
    <div className="insp-list">
      <div className="insp-label">
        {title} <span className="num">({items.length})</span>
      </div>
      <ul>
        {items.map((e) => (
          <li key={e.id}>{render(e)}</li>
        ))}
      </ul>
    </div>
  );
}
