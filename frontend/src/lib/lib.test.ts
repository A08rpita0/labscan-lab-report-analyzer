import { describe, expect, it } from "vitest";

import type { EvidenceGraphData, GraphEdge, GraphNode, Parameter } from "../api/types";
import { DEFAULT_QUERY, filterParameters, profilesOf, statusOf } from "./explorer";
import { num, pct, rangePosition, refText, repeats, score } from "./format";
import { edgeInLineage, layoutGraph, lineage, visibleGraph } from "./graphLayout";

describe("format", () => {
  it("prints numbers without locale surprises", () => {
    expect(num(5.6)).toBe("5.6");
    expect(num(0.123456)).toBe("0.1235");
    expect(num(68000)).toBe("68,000");
    expect(num(1.89837)).toBe("1.898");
    expect(num(136.92157)).toBe("136.9");
    expect(num(null)).toBe("—");
    expect(num("Positive")).toBe("Positive");
  });
  it("formats scores and percentages", () => {
    expect(score(0.9069)).toBe("0.91");
    expect(score(undefined)).toBe("—");
    expect(pct(0.8309)).toBe("83%");
  });
  it("writes one- and two-sided intervals", () => {
    expect(refText(125, 200)).toBe("125–200");
    expect(refText(null, 150)).toBe("≤ 150");
    expect(refText(30, null)).toBe("≥ 30");
    expect(refText(null, null)).toBeNull();
  });
  it("places a value on a two-sided interval only", () => {
    const p = rangePosition(150, 100, 200)!;
    expect(p.low).toBeLessThan(p.value);
    expect(p.value).toBeLessThan(p.high);
    expect(rangePosition(150, null, 200)).toBeNull();
    expect(rangePosition("Positive", 0, 1)).toBeNull();
    expect(rangePosition(10_000, 100, 200)!.offScale).toBe("above");
  });
});

const node = (id: string, type: GraphNode["type"], extra: Partial<GraphNode> = {}): GraphNode => ({ id, type, ref: id.slice(2), label: id, ...extra });
const edge = (source: string, target: string, kind = "trigger", extra: Partial<GraphEdge> = {}): GraphEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  kind,
  basis: "test",
  also: [],
  ...extra,
});

const graph: EvidenceGraphData = {
  nodes: [
    node("p:ldl", "parameter", { profile: "Lipid" }),
    node("p:tg", "parameter", { profile: "Lipid" }),
    node("p:tsh", "parameter", { profile: "Thyroid" }),
    node("c:lipid", "cohort", { confidence: 0.9 }),
    node("c:thyroid", "cohort", { confidence: 0.5 }),
    node("d:cvd", "condition", { score: 0.8, tier: "pattern" }),
    node("d:hypo", "condition", { score: 0.2, tier: "insufficient" }),
    node("a:a0", "action", { priority: "high" }),
  ],
  edges: [
    edge("p:ldl", "c:lipid", "trigger", { effective_weight: 1 }),
    edge("p:tg", "c:lipid", "supporting", { effective_weight: 0.4 }),
    edge("p:tsh", "c:thyroid", "trigger", { effective_weight: 0.8 }),
    edge("c:lipid", "d:cvd", "maps_to", { contribution: 0.8 }),
    edge("c:thyroid", "d:hypo", "maps_to", { contribution: 0.2 }),
    edge("d:cvd", "a:a0", "addresses"),
  ],
  stats: { nodes: {}, edges: 6, actions_without_evidence_link: 0, abnormal_parameters_not_in_graph: 0 },
  columns: ["parameter", "cohort", "condition", "action"],
};

describe("repeats", () => {
  it("drops a label that only echoes the value or badge", () => {
    expect(repeats("Equivocal", "Equivocal")).toBe(true);
    expect(repeats("Equivocal", "EQUIVOCAL", "Equivocal result")).toBe(true);
    expect(repeats("Positive", "Reactive (positive)")).toBe(false);
    expect(repeats("Diabetes range", 7.4)).toBe(false);
    expect(repeats("", 5)).toBe(true);
  });
});

describe("graph layout", () => {
  it("hides unsupported signals and orphaned parameters when asked", () => {
    const v = visibleGraph(graph, { showActions: true, showInsufficient: false });
    expect(v.nodes.map((n) => n.id)).not.toContain("d:hypo");
    expect(v.edges.every((e) => e.target !== "d:hypo")).toBe(true);
    expect(v.hidden.insufficient).toBe(1);
  });
  it("places every visible node in its type's column, without overlap", () => {
    const l = layoutGraph(graph, { width: 1000, showActions: true, showInsufficient: true });
    const cols = new Map(l.nodes.map((n) => [n.id, n.col]));
    expect(cols.get("p:ldl")).toBe(0);
    expect(cols.get("c:lipid")).toBe(1);
    expect(cols.get("d:cvd")).toBe(2);
    expect(cols.get("a:a0")).toBe(3);
    for (let c = 0; c < 4; c++) {
      const col = l.nodes.filter((n) => n.col === c).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) expect(col[i].y).toBeGreaterThanOrEqual(col[i - 1].y + col[i - 1].h);
    }
    expect(l.edges).toHaveLength(graph.edges.length);
  });
  it("draws larger contributions thicker", () => {
    const l = layoutGraph(graph, { width: 1000, showActions: false, showInsufficient: true });
    const w = (id: string) => l.edges.find((e) => e.id === id)!.strokeWidth;
    expect(w("c:lipid>d:cvd")).toBeGreaterThan(w("c:thyroid>d:hypo"));
    expect(l.nodes.some((n) => n.type === "action")).toBe(false);
  });
  it("lineage follows edge direction and never crosses into unrelated branches", () => {
    const set = lineage(graph.edges, "p:ldl");
    expect([...set].sort()).toEqual(["a:a0", "c:lipid", "d:cvd", "p:ldl"].sort());
    expect(set.has("p:tg")).toBe(false); // a sibling input is not part of LDL's lineage
    const fromSignal = lineage(graph.edges, "d:cvd");
    expect(fromSignal.has("p:tg") && fromSignal.has("p:ldl") && fromSignal.has("a:a0")).toBe(true);
    expect(fromSignal.has("p:tsh")).toBe(false);
    expect(edgeInLineage(graph.edges[0], set)).toBe(true);
    expect(edgeInLineage(graph.edges[2], set)).toBe(false);
  });
});

const param = (id: string, extra: Partial<Parameter>): Parameter =>
  ({
    parameter_id: id,
    name: id.toUpperCase(),
    profile: "Lipid Profile",
    kind: "numeric",
    value: 1,
    unit: "mg/dL",
    abnormal: false,
    direction: null,
    severity_score: 0,
    triggered_bands: [],
    raw: null,
    grade_label: null,
    ...extra,
  }) as Parameter;

describe("explorer", () => {
  const params = [
    param("ldl", { abnormal: true, direction: "high", severity_score: 0.5 }),
    param("hdl", {}),
    param("tsh", { profile: "Thyroid", triggered_bands: [{ cohort: "x", band: "y", observed: "z" }] }),
    param("hba1c", { profile: "Diabetes", abnormal: true, severity_score: 0.9 }),
  ];
  const linked = (pid: string) => pid === "ldl" || pid === "tsh";

  it("classifies results by status", () => {
    expect(params.map(statusOf)).toEqual(["abnormal", "normal", "rule", "abnormal"]);
  });
  it("puts what needs attention first by default", () => {
    expect(filterParameters(params, DEFAULT_QUERY, linked).map((p) => p.parameter_id)).toEqual(["hba1c", "ldl", "tsh", "hdl"]);
  });
  it("filters by status, profile, linkage and text together", () => {
    expect(filterParameters(params, { ...DEFAULT_QUERY, status: "abnormal", link: "unlinked" }, linked).map((p) => p.parameter_id)).toEqual(["hba1c"]);
    expect(filterParameters(params, { ...DEFAULT_QUERY, profile: "Thyroid" }, linked)).toHaveLength(1);
    expect(filterParameters(params, { ...DEFAULT_QUERY, text: "lipid hd" }, linked).map((p) => p.parameter_id)).toEqual(["hdl"]);
  });
  it("counts results and abnormalities per profile", () => {
    expect(profilesOf(params)[0]).toEqual({ profile: "Lipid Profile", total: 2, abnormal: 1 });
  });
});
