/* Layered layout for the evidence graph.
 *
 * The backend returns nodes and edges only (engine/explain.py); placement is a
 * presentation concern and lives here. The graph is a DAG read left to right:
 *
 *     laboratory parameter -> pattern (cohort) -> risk signal (condition) -> action
 *
 * so a classic layered (Sugiyama-style) layout fits: fixed columns by node type, then a
 * few barycentre sweeps to order each column by the mean position of its neighbours,
 * which removes most edge crossings without any layout library. */

import type { EvidenceGraphData, GraphEdge, GraphNode, NodeType } from "../api/types";

export const COLUMN_ORDER: NodeType[] = ["parameter", "cohort", "condition", "action"];

export interface LayoutOptions {
  width: number;
  showActions: boolean;
  showInsufficient: boolean;
}

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
}

export interface PlacedEdge extends GraphEdge {
  path: string;
  strokeWidth: number;
  span: number; // columns crossed: 1 for adjacent layers
}

export interface GraphLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  columnX: number[];
  nodeWidth: number;
  hidden: { insufficient: number; actions: number };
}

const NODE_H: Record<NodeType, number> = { parameter: 38, cohort: 46, condition: 50, action: 40 };
const V_GAP = 10;
const TOP = 34; // room for column headings

export function visibleGraph(g: EvidenceGraphData, opts: Pick<LayoutOptions, "showActions" | "showInsufficient">) {
  const hiddenIds = new Set<string>();
  let insufficient = 0;
  let actions = 0;
  for (const n of g.nodes) {
    if (n.type === "condition" && n.tier === "insufficient" && !opts.showInsufficient) {
      hiddenIds.add(n.id);
      insufficient++;
    }
    if (n.type === "action" && !opts.showActions) {
      hiddenIds.add(n.id);
      actions++;
    }
  }
  let edges = g.edges.filter((e) => !hiddenIds.has(e.source) && !hiddenIds.has(e.target));
  // A parameter whose only links went to hidden nodes would float unattached.
  const linked = new Set<string>();
  for (const e of edges) {
    linked.add(e.source);
    linked.add(e.target);
  }
  const nodes = g.nodes.filter((n) => !hiddenIds.has(n.id) && (linked.has(n.id) || n.type === "condition"));
  const keep = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { nodes, edges, hidden: { insufficient, actions } };
}

function initialOrder(a: GraphNode, b: GraphNode): number {
  switch (a.type) {
    case "parameter":
      return (a.profile || "").localeCompare(b.profile || "") || a.label.localeCompare(b.label);
    case "cohort":
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    case "condition":
      return (b.score ?? 0) - (a.score ?? 0);
    default: {
      const ai = parseInt(a.ref.slice(1), 10);
      const bi = parseInt(b.ref.slice(1), 10);
      return ai - bi;
    }
  }
}

export function layoutGraph(g: EvidenceGraphData, opts: LayoutOptions): GraphLayout {
  const { nodes, edges, hidden } = visibleGraph(g, opts);
  const colOf = (n: GraphNode) => COLUMN_ORDER.indexOf(n.type);
  const usedCols = opts.showActions ? 4 : 3;

  const columns: GraphNode[][] = Array.from({ length: usedCols }, () => []);
  for (const n of nodes) {
    const c = colOf(n);
    if (c < usedCols) columns[c].push(n);
  }
  columns.forEach((col) => col.sort(initialOrder));

  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    (neighbours.get(e.source) ?? neighbours.set(e.source, []).get(e.source)!).push(e.target);
    (neighbours.get(e.target) ?? neighbours.set(e.target, []).get(e.target)!).push(e.source);
  }
  const index = new Map<string, number>();
  const reindex = () => columns.forEach((col) => col.forEach((n, i) => index.set(n.id, i / Math.max(1, col.length - 1))));
  reindex();

  const colById = new Map(nodes.map((n) => [n.id, colOf(n)] as const));
  const sweep = (col: GraphNode[], ref: number) => {
    const bary = new Map<string, number>();
    col.forEach((n, i) => {
      const ns = (neighbours.get(n.id) ?? []).filter((id) => colById.get(id) === ref);
      bary.set(n.id, ns.length ? ns.reduce((s, id) => s + (index.get(id) ?? 0), 0) / ns.length : i / Math.max(1, col.length - 1));
    });
    col.sort((a, b) => (bary.get(a.id)! - bary.get(b.id)!) || initialOrder(a, b));
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let c = 1; c < usedCols; c++) {
      sweep(columns[c], c - 1);
      reindex();
    }
    for (let c = usedCols - 2; c >= 0; c--) {
      sweep(columns[c], c + 1);
      reindex();
    }
  }

  const width = Math.max(opts.width, usedCols * 190);
  const gutter = Math.max(44, Math.min(110, width * 0.06));
  const nodeWidth = Math.min(232, (width - gutter * (usedCols - 1)) / usedCols);
  const columnX = Array.from({ length: usedCols }, (_, c) => c * (nodeWidth + gutter));

  // Vertical placement. The first column stacks from the top; every later node is placed
  // at the mean height of the nodes that feed it, then pushed down just enough not to
  // overlap its predecessor. Edges therefore run close to horizontal, instead of a short
  // column floating in the middle of a tall one with long diagonals into it.
  const placed = new Map<string, PlacedNode>();
  columns.forEach((col, c) => {
    const desired = new Map<string, number>();
    for (const n of col) {
      const feeders = c === 0 ? [] : (neighbours.get(n.id) ?? []).map((id) => placed.get(id)).filter((p): p is PlacedNode => !!p && p.col < c);
      desired.set(n.id, feeders.length ? feeders.reduce((s, p) => s + p.y + p.h / 2, 0) / feeders.length : -1);
    }
    if (c > 0) col.sort((a, b) => desired.get(a.id)! - desired.get(b.id)! || initialOrder(a, b));
    let y = TOP;
    for (const n of col) {
      const h = NODE_H[n.type];
      const want = desired.get(n.id)!;
      const top = want < 0 ? y : Math.max(y, want - h / 2);
      placed.set(n.id, { ...n, x: columnX[c], y: top, w: nodeWidth, h, col: c });
      y = top + h + V_GAP;
    }
  });
  const height = Math.max(TOP + 120, ...[...placed.values()].map((n) => n.y + n.h + 8));

  const maxContribution = Math.max(0.0001, ...edges.map((e) => e.contribution ?? 0));
  const maxWeight = Math.max(0.0001, ...edges.map((e) => e.effective_weight ?? 0));
  const placedEdges: PlacedEdge[] = [];
  for (const e of edges) {
    const s = placed.get(e.source);
    const t = placed.get(e.target);
    if (!s || !t) continue;
    const x1 = s.x + s.w;
    const y1 = s.y + s.h / 2;
    const x2 = t.x;
    const y2 = t.y + t.h / 2;
    const dx = Math.max(30, (x2 - x1) * 0.5);
    let strokeWidth = 1.25;
    if (e.contribution !== undefined) strokeWidth = 1.25 + 4.5 * (e.contribution / maxContribution);
    else if (e.effective_weight !== undefined) strokeWidth = 1 + 3 * (e.effective_weight / maxWeight);
    placedEdges.push({
      ...e,
      path: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
      strokeWidth,
      span: t.col - s.col,
    });
  }

  return {
    nodes: [...placed.values()],
    edges: placedEdges,
    width: columnX[usedCols - 1] + nodeWidth,
    height,
    columnX,
    nodeWidth,
    hidden,
  };
}

/** Every node on a path through `id`: its ancestors and its descendants, following
 *  edge direction. Selecting a parameter lights up the patterns it fired, the signals
 *  those patterns raised and the plan steps that followed - its lineage, and nothing
 *  that merely shares a neighbour with it. */
export function lineage(edges: Pick<GraphEdge, "source" | "target">[], id: string): Set<string> {
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const e of edges) {
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e.target);
    (inc.get(e.target) ?? inc.set(e.target, []).get(e.target)!).push(e.source);
  }
  const seen = new Set<string>([id]);
  const walk = (start: string, adj: Map<string, string[]>) => {
    const stack = [start];
    const visited = new Set<string>([start]);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nxt of adj.get(cur) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          seen.add(nxt);
          stack.push(nxt);
        }
      }
    }
  };
  walk(id, out);
  walk(id, inc);
  return seen;
}

export function edgeInLineage(e: Pick<GraphEdge, "source" | "target">, set: Set<string>): boolean {
  return set.has(e.source) && set.has(e.target);
}
