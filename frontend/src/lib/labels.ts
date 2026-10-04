/* Wording for enum values the backend returns. Interface vocabulary only - nothing here
 * decides what a result means; it names states the engine already assigned. */

import type { EvidenceLevel, Tier } from "../api/types";

/** Evidence level as a match strength - never as the likelihood of a disease. */
export const LEVEL_WORD: Record<EvidenceLevel, string> = {
  High: "Strong evidence",
  Moderate: "Moderate evidence",
  Low: "Weak evidence",
  Limited: "Insufficient evidence",
};

export const TIER_WORD: Record<Tier, string> = {
  direct: "Direct finding",
  derived: "Calculated finding",
  pattern: "Pattern signal",
  insufficient: "Considered, not supported",
};

export const TIER_HELP: Record<Tier, string> = {
  direct: "One measured value meets a configured threshold that establishes this finding on its own.",
  derived: "The establishing value was calculated by this engine from other results, not measured by a laboratory.",
  pattern: "A combination of results matches a configured pattern associated with this condition. A hypothesis to explore, not a diagnosis.",
  insufficient: "The engine assessed this, but the evidence does not support reporting it as a finding.",
};

export const URGENCY_WORD: Record<string, string> = {
  emergency: "Time-critical",
  specialist: "Specialist review",
  monitoring: "Monitoring",
  routine: "Routine",
  unknown: "Not stated",
};

export const PRIORITY_WORD: Record<string, string> = {
  urgent: "Urgent",
  high: "High priority",
  medium: "Follow-up",
  low: "General",
};

export const BASIS_WORD: Record<string, string> = {
  lab_range: "Outside laboratory range",
  decision_threshold: "Past a guideline threshold",
  derived: "Calculated value",
  normal: "Within range",
};

export const ROLE_WORD: Record<string, string> = {
  trigger: "Defining trigger",
  supporting: "Supporting signal",
  component: "Criterion component",
  primary: "Primary link",
  downstream_risk: "Downstream risk",
  differential: "Differential",
};

export const EDGE_WORD: Record<string, string> = {
  trigger: "fires pattern (defining trigger)",
  supporting: "supports pattern",
  component: "meets a criterion component",
  maps_to: "maps to Disease Master row",
  direct_criterion: "meets a direct single-marker criterion",
  addresses: "plan step titled by this",
  cohort_action: "plan step from this pattern's action library",
  parameter_action: "plan step from this result's action library",
  source: "listed as a source of the step",
  cites: "value quoted in the step",
  would_test: "missing tests requested by the step",
};

export const COHORT_STATUS_WORD: Record<string, string> = {
  fired: "Fired",
  not_met: "Assessed, not met",
  not_assessable: "Not assessable",
  no_data: "No relevant data",
  not_applicable: "Not applicable",
  suppressed: "Suppressed by exclusion",
};

export const CANDIDATE_STATUS_WORD: Record<string, string> = {
  reported: "Reported",
  gated: "Gated out (required marker did not fire)",
  below_reporting_floor: "Below reporting floor",
  suppressed_by_exclusion: "Suppressed by exclusion rule",
};

export const TRACE_WORD: Record<string, string> = {
  urgency: "Triage rule",
  disease_guidance: "Disease Master guidance",
  cohort_action: "Pattern action library",
  parameter_action: "Result action library",
  coverage_gap: "Data coverage gap",
  record_context: "Record completeness",
  lab_noted: "Laboratory-marked result",
  data_quality: "Data quality check",
  lab_finding: "Uncovered abnormal result",
  baseline: "Baseline guidance",
  general: "General guidance",
};

export const STAGE_WORD: Record<string, string> = {
  extraction: "Extraction",
  normalization: "Normalization",
  document_check: "Document check",
  exclusion_gates: "Exclusion gates",
  cohort_detection: "Pattern detection",
  risk_scoring: "Evidence aggregation",
  lab_findings: "Lab findings",
  recommendations: "Action mapping",
  explainability: "Explainability",
  assembly: "Response assembly",
};

export const EXERCISE_WORD: Record<string, string> = {
  nested_json: "Nested JSON",
  flat_json: "Flat JSON",
  cross_profile_patterns: "Cross-profile patterns",
  derived_values: "Derived values",
  unit_conversion: "Unit conversion",
  qualitative_results: "Qualitative results",
  exclusion_gates: "Exclusion gates",
  link_gating: "Link gating",
  sparse_input: "Sparse input",
  missing_demographics: "Missing demographics",
  negative_control: "Negative control",
  deep_nesting: "Deep nesting",
  duplicate_resolution: "Duplicate resolution",
  null_values: "Null values",
  pdf_extraction: "PDF extraction",
  multi_profile: "Multi-profile",
  csv_extraction: "CSV extraction",
  lab_flags: "Lab flags",
};

export function word(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return map[key] ?? key.replace(/_/g, " ");
}
