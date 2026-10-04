/* Plain-language grouping of results for the beginner view.
 *
 * Three levels, each defined only from what the engine already decided:
 *
 *   important  the engine graded the result severe or critical (severity >= 0.75 - the
 *              same boundary engine/recommend.py uses for "markedly outside its range"),
 *              or the result is behind a finding that needs same-day care
 *   attention  any other result the engine flagged: outside its range, or inside the
 *              lab's printed range but past a guideline level the engine applies
 *   normal     every other recognised result
 *
 * Nothing here grades a value. It only sorts the engine's verdicts into words a
 * first-time reader understands. */

import type { Analysis, LabFinding, Parameter } from "../api/types";

export type Level = "important" | "attention" | "normal";

export const MARKED_SEVERITY = 0.75;

export interface ResultItem {
  id: string;
  name: string;
  group: string | null; // plain name of the test group
  value: unknown;
  unit: string | null;
  low: number | null;
  high: number | null;
  level: Level;
  /** One plain sentence: why this result is in its group. */
  reason: string;
  /** The lab's / guideline's own term for the reading, shown as secondary text. */
  medicalTerm: string | null;
  /** Findings this result contributes to, by their display names. */
  linkedTo: string[];
  derived: boolean;
  checkReading: boolean;
  direction: string | null;
}

/** Plain names for the profile groups the parameter dictionary uses. Interface
 *  wording only; an unknown profile keeps its own name. */
const GROUP_WORD: Record<string, string> = {
  "Lipid Profile": "Cholesterol and blood fats",
  "Diabetes Monitoring": "Blood sugar",
  "Kidney Profile": "Kidney function",
  "Liver Profile": "Liver function",
  "Blood Counts": "Blood cells",
  "Electrolyte Profile": "Body salts (electrolytes)",
  "Thyroid Profile": "Thyroid",
  "BMI & BP": "Body weight and blood pressure",
  "Cardiac Profile": "Heart",
  "Vitamin Profile": "Vitamins",
  "Anemia Studies": "Iron and anaemia",
  "Infectious Diseases": "Infection tests",
  "Urinalysis": "Urine",
  "Stool Analysis": "Stool",
  "Mineral Profile": "Minerals",
  "Blood Clotting": "Blood clotting",
  "Prothrombin Time": "Blood clotting",
  "Bone Health": "Bone health",
  "Hemoglobin Electrophoresis": "Haemoglobin types",
  "Pancreas": "Pancreas",
};

export function plainGroup(profile: string | null | undefined): string | null {
  if (!profile) return null;
  return GROUP_WORD[profile] ?? profile.replace(/ Profile$/, "");
}

function reasonFor(f: LabFinding, level: Level): string {
  if (f.data_quality === "suspicious") {
    return f.data_quality_reason
      ? `Ask the lab to confirm this result. Why: ${f.data_quality_reason.charAt(0).toUpperCase()}${f.data_quality_reason.slice(1).replace(/\.$/, "")}.`
      : "This value is unusual. Ask the lab to confirm it before acting on it.";
  }
  if (f.derived) return "Calculated from your other results, and outside the usual range.";
  if (f.kind === "qualitative" || typeof f.value !== "number") {
    return `Reported as “${String(f.value)}”, which is not the expected result.`;
  }
  if (f.in_lab_range) {
    return "Inside the lab's printed normal range, but past the level medical guidelines use.";
  }
  const far = level === "important";
  if (f.direction === "high") return far ? "Much higher than the normal range." : "Higher than the normal range.";
  if (f.direction === "low") return far ? "Much lower than the normal range." : "Lower than the normal range.";
  return "Outside the normal range.";
}

export function classifyResults(a: Analysis): { important: ResultItem[]; attention: ResultItem[]; normal: ResultItem[] } {
  const urgentInputs = new Set(
    a.urgent_findings.flatMap((r) => r.triggering_parameters.filter((t) => !t.discounted).map((t) => t.parameter_id)),
  );
  const flagged = [...a.abnormal_findings, ...a.threshold_findings].filter((f) => f.parameter_id);
  const flaggedIds = new Set(flagged.map((f) => f.parameter_id as string));

  const toItem = (f: LabFinding): ResultItem => {
    const important = f.abnormal && (f.severity_score >= MARKED_SEVERITY || urgentInputs.has(f.parameter_id as string));
    const level: Level = important ? "important" : "attention";
    return {
      id: f.parameter_id as string,
      name: f.name,
      group: plainGroup(f.profile),
      value: f.value,
      unit: f.unit,
      low: f.reference_low ?? null,
      high: f.reference_high ?? null,
      level,
      reason: reasonFor(f, level),
      medicalTerm: f.grade_label,
      linkedTo: [...new Set(f.linked.filter((l) => l.kind === "condition").map((l) => l.name))],
      derived: f.derived,
      checkReading: f.data_quality === "suspicious",
      direction: f.direction ?? null,
    };
  };

  const items = flagged.map(toItem);
  const bySeverity = (x: ResultItem, y: ResultItem) => {
    const fx = flagged.find((f) => f.parameter_id === x.id)!.severity_score;
    const fy = flagged.find((f) => f.parameter_id === y.id)!.severity_score;
    return fy - fx || x.name.localeCompare(y.name);
  };

  const normal: ResultItem[] = a.parameters
    .filter((p: Parameter) => !flaggedIds.has(p.parameter_id) && !p.abnormal)
    .map((p) => ({
      id: p.parameter_id,
      name: p.name,
      group: plainGroup(p.profile),
      value: p.value ?? p.status ?? p.category,
      unit: p.unit,
      low: p.reference_low,
      high: p.reference_high,
      level: "normal" as const,
      reason: "Within the normal range.",
      medicalTerm: null,
      linkedTo: [],
      derived: p.derived,
      checkReading: false,
      direction: null,
    }))
    .sort((x, y) => (x.group ?? "").localeCompare(y.group ?? "") || x.name.localeCompare(y.name));

  return {
    important: items.filter((i) => i.level === "important").sort(bySeverity),
    attention: items.filter((i) => i.level === "attention").sort(bySeverity),
    normal,
  };
}

/** Match strength in everyday words - never a probability of disease. */
export const MATCH_WORD: Record<string, string> = {
  High: "Strong match",
  Moderate: "Possible match",
  Low: "Weak match",
  Limited: "Not enough evidence",
};

export const STEP_GROUP: Record<string, { title: string; help: string }> = {
  urgent: { title: "Do this today", help: "Seek medical care now rather than waiting for a routine appointment." },
  high: { title: "Arrange soon", help: "Book an appointment and take this report with you." },
  medium: { title: "At your next appointment", help: "Worth discussing, but not urgent." },
  low: { title: "Good everyday habits", help: "General advice that applies to most people." },
};
