import { describe, expect, it } from "vitest";

import type { Analysis, LabFinding, Parameter } from "../api/types";
import { classifyResults, MARKED_SEVERITY, plainGroup } from "./classify";

const finding = (id: string, extra: Partial<LabFinding>): LabFinding =>
  ({
    parameter_id: id,
    name: id.toUpperCase(),
    profile: "Kidney Profile",
    kind: "numeric",
    value: 10,
    unit: "mg/dL",
    reference_text: "1-5",
    reference_low: 1,
    reference_high: 5,
    finding_basis: "lab_range",
    in_lab_range: false,
    abnormal: true,
    direction: "high",
    severity_score: 0.55,
    grade_label: "Moderately raised",
    statement: "",
    standalone: false,
    derived: false,
    lab_flag: null,
    linked: [{ kind: "condition", name: "Kidney concern", tier: "pattern", evidence_level: "Moderate" }],
    data_quality: "valid",
    ...extra,
  }) as LabFinding;

const param = (id: string, extra: Partial<Parameter> = {}): Parameter =>
  ({ parameter_id: id, name: id, profile: "Lipid Profile", value: 3, unit: "mmol/L", status: null, category: null, reference_low: 1, reference_high: 5, abnormal: false, derived: false, ...extra }) as Parameter;

const analysis = (over: Partial<Analysis>): Analysis =>
  ({
    abnormal_findings: [],
    threshold_findings: [],
    parameters: [],
    urgent_findings: [],
    ...over,
  }) as unknown as Analysis;

describe("classifyResults", () => {
  it("uses the engine's own severity boundary for Important", () => {
    const a = analysis({
      abnormal_findings: [finding("creat", { severity_score: MARKED_SEVERITY }), finding("urea", { severity_score: 0.55 })],
      parameters: [param("creat", { abnormal: true }), param("urea", { abnormal: true }), param("hdl")],
    });
    const g = classifyResults(a);
    expect(g.important.map((i) => i.id)).toEqual(["creat"]);
    expect(g.attention.map((i) => i.id)).toEqual(["urea"]);
    expect(g.normal.map((i) => i.id)).toEqual(["hdl"]);
  });

  it("treats a result behind a same-day finding as Important even at moderate severity", () => {
    const a = analysis({
      abnormal_findings: [finding("k", { severity_score: 0.55 })],
      urgent_findings: [{ triggering_parameters: [{ parameter_id: "k", discounted: false }] }] as unknown as Analysis["urgent_findings"],
    });
    expect(classifyResults(a).important.map((i) => i.id)).toEqual(["k"]);
  });

  it("explains each group in plain words, never engine terms", () => {
    const a = analysis({
      abnormal_findings: [finding("hi", { severity_score: 0.8 }), finding("lo", { direction: "low" })],
      threshold_findings: [finding("tsh", { in_lab_range: true, abnormal: false, severity_score: 0 })],
    });
    const g = classifyResults(a);
    const all = [...g.important, ...g.attention];
    expect(all.find((i) => i.id === "hi")!.reason).toBe("Much higher than the normal range.");
    expect(all.find((i) => i.id === "lo")!.reason).toBe("Lower than the normal range.");
    expect(all.find((i) => i.id === "tsh")!.reason).toMatch(/Inside the lab's printed normal range/);
    for (const i of all) expect(i.reason).not.toMatch(/cohort|noisy|signal|evidence|threshold_|decision/i);
  });

  it("orders flagged results by severity and keeps their links and ranges", () => {
    const a = analysis({ abnormal_findings: [finding("a", { severity_score: 0.25 }), finding("b", { severity_score: 0.55 })] });
    const g = classifyResults(a);
    expect(g.attention.map((i) => i.id)).toEqual(["b", "a"]);
    expect(g.attention[0]).toMatchObject({ low: 1, high: 5, linkedTo: ["Kidney concern"], group: "Kidney function" });
  });

  it("flags readings to confirm and calculated values in their own words", () => {
    const a = analysis({
      abnormal_findings: [
        finding("odd", { data_quality: "suspicious", data_quality_reason: "reported more than once with different results (9.8, 9.9)" }),
        finding("ratio", { derived: true }),
      ],
    });
    const g = classifyResults(a);
    expect(g.attention.find((i) => i.id === "odd")!.reason).toBe(
      "Ask the lab to confirm this result. Why: Reported more than once with different results (9.8, 9.9).",
    );
    expect(g.attention.find((i) => i.id === "ratio")!.reason).toMatch(/Calculated from your other results/);
  });

  it("names groups plainly and falls back to the profile name", () => {
    expect(plainGroup("Lipid Profile")).toBe("Cholesterol and blood fats");
    expect(plainGroup("Toxic elements")).toBe("Toxic elements");
    expect(plainGroup("Allergy Panel")).toBe("Allergy Panel");
    expect(plainGroup(null)).toBeNull();
  });
});
