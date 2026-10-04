/* Types for the LabScan analysis API.
 *
 * Mirrors what the backend actually returns (engine/pipeline.py `_assemble`,
 * engine/models.py `to_dict`, engine/explain.py). Fields are optional where the engine
 * omits them for some inputs - never invented here. */

export type Num = number;
export type Value = number | string | null;

export interface RawObservation {
  raw_name: string;
  raw_value: unknown;
  raw_unit: string | null;
  raw_range: string | null;
  raw_flag: string | null;
  source_path: string | null;
  source_kind: string;
  shape: string;
  origin: string;
  section: string | null;
  method: string | null;
}

export type FindingBasis = "lab_range" | "decision_threshold" | "derived" | "normal";

export interface Parameter {
  parameter_id: string;
  name: string;
  profile: string | null;
  kind: "numeric" | "qualitative" | "categorical" | string;
  value: number | null;
  unit: string | null;
  status: string | null;
  category: string | null;
  result_state: string | null;
  printed_band: string | null;
  lab_range_status: string | null;
  data_quality: "valid" | "suspicious" | string;
  data_quality_reason: string | null;
  reference_low: number | null;
  reference_high: number | null;
  reference_source: string;
  abnormal: boolean;
  direction: string | null;
  grade: string;
  grade_label: string | null;
  severity_score: number;
  interpretable: boolean;
  derived: boolean;
  derivation: string | null;
  raw: RawObservation | null;
  conversion_note: string | null;
  notes: string[];
  finding_basis: FindingBasis;
  graded_by: string;
  triggered_bands: { cohort: string; band: string; observed: string }[];
}

export interface TriggerHit {
  parameter_id: string;
  parameter_name: string;
  label: string;
  observed: string;
  weight: number;
  effective_weight: number;
  role: "trigger" | "supporting" | "component" | string;
  redundancy_group: string | null;
  suppressed_by: string | null;
}

export interface Citation {
  citation: string;
  note?: string;
}

export interface CohortHit {
  cohort_id: string;
  name: string;
  category: string;
  description: string;
  profiles_touched: string[];
  cross_profile_rationale: string | null;
  mode: "weighted" | "count_of" | string;
  hits: TriggerHit[];
  components_met: { id: string; label: string; evidence: string }[];
  components_unmet: { id: string; label: string; status: string; parameters: string[] }[];
  confidence: number;
  data_coverage: number;
  parameters_observed: string[];
  parameters_missing: string[];
  evidence: Citation[];
  urgency_override: string | null;
  explanation: string;
  confidence_breakdown: Record<string, unknown>;
}

export interface Contribution {
  cohort_id: string;
  cohort_name: string;
  role: string;
  link_weight: number;
  cohort_confidence: number;
  contribution: number;
  dm_basis: string;
  support_penalty: number;
  support_note: string;
  presented_as: string | null;
}

export interface Measurement {
  parameter_id: string;
  name: string;
  value: Value;
  unit: string | null;
  reference_low: number | null;
  reference_high: number | null;
  reference_source?: string;
  reading: string | null;
  abnormal?: boolean;
  derived?: boolean;
}

export interface TriggeringParameter {
  parameter_id: string;
  name: string;
  profile: string | null;
  observed: string;
  finding: string;
  via_cohort: string;
  discounted: boolean;
}

export type Tier = "direct" | "derived" | "pattern" | "insufficient";
export type EvidenceLevel = "High" | "Moderate" | "Low" | "Limited";

export interface DiseaseRisk {
  disease_id: string;
  name: string;
  display_name: string | null;
  display_note: string | null;
  classification: string;
  profiles: string[];
  score: number;
  evidence_level: EvidenceLevel;
  evidence_capped: boolean;
  urgency_tier: string;
  urgency_raw: string | null;
  conditional_urgency: string | null;
  urgency_escalation: string | null;
  contributions: Contribution[];
  triggering_parameters: TriggeringParameter[];
  cohorts: { id: string; name: string; confidence: number; role: string }[];
  data_coverage: number;
  missing_parameters: string[];
  confirmatory_tests: string | null;
  explanation: string;
  dm_fields: Record<string, string | null>;
  review_status: string | null;
  icd10: string | null;
  unconfirmed_reason: string | null;
  evidence_type: string | null;
  finding_type: "direct" | "pattern";
  direct_evidence: Record<string, unknown> | null;
  presentation_tier: Tier;
  score_breakdown: Record<string, unknown>;
  contradicting: Measurement[];
  context_values: Measurement[];
}

export interface LabFinding {
  parameter_id: string | null;
  name: string;
  profile: string | null;
  kind: string;
  value: Value;
  unit: string | null;
  reference_text: string | null;
  reference_low?: number | null;
  reference_high?: number | null;
  finding_basis: string;
  in_lab_range: boolean;
  abnormal: boolean;
  direction?: string | null;
  severity_score: number;
  grade_label: string | null;
  statement: string;
  standalone: boolean;
  derived: boolean;
  lab_flag: string | null;
  linked: { kind: string; name: string; tier: string; evidence_level: string | null }[];
  data_quality?: string;
  data_quality_reason?: string | null;
}

export interface Recommendation {
  id: string;
  category: string;
  priority: "urgent" | "high" | "medium" | "low";
  text: string;
  because: string;
  sources: string[];
  finding: string;
  finding_display: string;
  finding_kind: string;
  values: {
    parameter_id: string;
    name: string;
    value: Value;
    unit: string | null;
    reference_low: number | null;
    reference_high: number | null;
    reading: string | null;
    in_range: boolean;
  }[];
  timeframe: string;
  trace: string;
  trace_detail: string;
}

export interface UnmappedObservation {
  raw_name: string;
  raw_value: unknown;
  raw_unit: string | null;
  raw_range: string | null;
  source_path: string | null;
  source_kind: string;
}

export interface SuppressedFinding {
  rule_id: string;
  parameter_name: string;
  observed: string;
  reason: string;
  user_message: string;
  basis: string;
  disease?: string;
  name?: string;
  cohort_id?: string;
  would_have_fired_from?: string[];
}

/* ---- explainability (engine/explain.py) ---- */

export type NodeType = "parameter" | "cohort" | "condition" | "action";

export interface GraphNode {
  id: string;
  type: NodeType;
  ref: string;
  label: string;
  // parameter
  profile?: string | null;
  value?: Value;
  unit?: string | null;
  abnormal?: boolean;
  direction?: string | null;
  grade_label?: string | null;
  reference_low?: number | null;
  reference_high?: number | null;
  reference_source?: string;
  finding_basis?: string;
  derived?: boolean;
  data_quality?: string;
  // cohort
  category?: string;
  mode?: string;
  confidence?: number;
  data_coverage?: number;
  parameters_observed?: number;
  parameters_expected?: number;
  profiles?: string[];
  cross_profile?: boolean;
  urgency_override?: string | null;
  citations?: number;
  // condition
  dm_name?: string;
  classification?: string;
  score?: number;
  evidence_level?: EvidenceLevel;
  tier?: Tier;
  finding_type?: string;
  urgency_tier?: string;
  capped?: boolean;
  icd10?: string | null;
  // action
  priority?: string;
  text?: string;
  trace?: string;
  timeframe?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  basis: string;
  also: string[];
  rule?: string;
  observed?: string;
  weight?: number;
  effective_weight?: number;
  discounted?: string | null;
  role?: string;
  link_weight?: number;
  cohort_confidence?: number;
  role_factor?: number;
  support_penalty?: number;
  support_note?: string;
  contribution?: number;
  dm_basis?: string;
  statement?: string;
  threshold_source?: string;
}

export interface EvidenceGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodes: Partial<Record<NodeType, number>>;
    edges: number;
    actions_without_evidence_link: number;
    abnormal_parameters_not_in_graph: number;
  };
  columns: NodeType[];
}

export interface TraceStep {
  stage: "input" | "normalization" | "abnormality" | "pattern" | "mapping" | "aggregation" | "recommendation";
  title: string;
  summary: string;
  items?: Record<string, any>[];
  data?: Record<string, any>;
}

export interface ReasoningTrace {
  disease_id: string;
  name: string;
  display_name: string;
  presentation_tier: Tier;
  evidence_level: EvidenceLevel;
  steps: TraceStep[];
  would_strengthen: { missing_parameters: { id: string; name: string }[]; confirmatory_tests: string | null };
  argues_against: Measurement[];
  measured_normal_context: Measurement[];
}

export interface CohortEvaluationRow {
  id: string;
  name: string;
  category: string | null;
  mode: string;
  status: "fired" | "suppressed" | "not_assessable" | "not_applicable" | "no_data" | "not_met";
  parameters_present: number;
  parameters_referenced: number;
  confidence?: number;
  reason?: string;
}

export interface Explainability {
  graph: EvidenceGraphData;
  traces: ReasoningTrace[];
  parameter_links: Record<string, {
    cohorts: { id: string; name: string; rule: string; role: string; effective_weight: number; discounted: string | null }[];
    conditions: { id: string; name: string; via: string }[];
    actions: string[];
  }>;
  cohort_evaluation: { configured: number; totals: Record<string, number>; rules: CohortEvaluationRow[] };
  condition_candidates: {
    linked_from_fired_patterns: number;
    totals: Record<string, number>;
    rows: { name: string; status: string; via: string[] }[];
    reporting_floor: number;
  };
  parameter_names: Record<string, string>;
  scale: {
    evidence_bands: { level: EvidenceLevel; min_score: number }[];
    reporting_floor: number;
    urgent_score_floor: number;
    contribution_ceiling: number;
    role_factor: Record<string, number>;
  };
}

export interface RunInfo {
  stages: { stage: string; ms: number }[];
  total_ms: number;
  clock: string;
}

export interface EngineInfo {
  version: string;
  deterministic?: boolean;
  config: ConfigFingerprint;
}

export interface ConfigFingerprint {
  sha256: string;
  files: number;
  parameter_dictionary_version: string | null;
  disease_master_source: string | null;
  disease_master_last_updated: string | null;
}

export interface DocumentVerdict {
  status: "ok" | "unreadable" | "not_a_report";
  is_report: boolean;
  title: string | null;
  guidance: string | null;
  signals: Record<string, unknown>;
  accepted_formats: string[];
  incomplete?: { unreadable_pages: number; message: string };
}

export interface Summary {
  observations_found: number;
  parameters_recognised: number;
  parameters_unmapped: number;
  document_fields_skipped: number;
  values_rejected: number;
  results_pending: number;
  lab_noted_findings: number;
  derived_values: number;
  duplicates_resolved: number;
  abnormal_count: number;
  abnormal_findings: number;
  abnormal_standalone: number;
  decision_threshold_count: number;
  profiles_touched: string[];
  cohorts_detected: number;
  conditions_flagged: number;
  direct_findings: number;
  derived_findings: number;
  pattern_findings: number;
  insufficient_findings: number;
  suppressed_by_exclusion: number;
  high_evidence: number;
  moderate_evidence: number;
  limited_evidence: number;
  urgent_findings: number;
  analysis_confidence: string;
  data_coverage_level: string;
  cohorts_evaluated: number;
  conditions_considered: number;
}

export interface Analysis {
  generated_at: string;
  source_file: string;
  analysed: true;
  engine: EngineInfo;
  document: DocumentVerdict;
  disclaimer: string;
  provenance: {
    disease_master_source: string | null;
    disease_master_rows: number | null;
    cohorts_configured: number;
    evidence_citations: number;
    note: string | null;
  };
  patient: {
    patient_id: string | null;
    name: string | null;
    sex: string | null;
    age: number | null;
    report_date: string | null;
    smoking: boolean | null;
    source_file: string | null;
  };
  summary: Summary;
  parameters: Parameter[];
  abnormal_findings: LabFinding[];
  threshold_findings: LabFinding[];
  lab_noted_findings: LabFinding[];
  parameters_by_profile: Record<string, string[]>;
  unmapped_observations: UnmappedObservation[];
  document_fields_skipped: UnmappedObservation[];
  rejected_values: { parameter: string; reported: unknown; unit?: string | null; reason: string }[];
  pending_results: Record<string, unknown>[];
  duplicates_resolved: Record<string, any>[];
  warnings: string[];
  cohorts: CohortHit[];
  cohorts_not_assessable: { cohort_id: string; name: string; reason: string }[];
  disease_risks: DiseaseRisk[];
  suppressed_findings: SuppressedFinding[];
  urgent_findings: DiseaseRisk[];
  recommendations: Recommendation[];
  coverage: {
    overall: string;
    note: string;
    parameters_recognised: number;
    capped_conditions: string[];
    capped_note: string | null;
  };
  explainability: Explainability;
  run: RunInfo;
}

export interface Sample {
  file: string;
  title: string;
  description: string;
  scenario: string | null;
  format: string;
  size_bytes: number;
  exercises: string[];
}

export interface Health {
  status: "ok" | "config_error";
  version: string;
  config: Record<string, number>;
  config_fingerprint: ConfigFingerprint;
  errors: string[];
  warning_count: number;
  limits: { max_upload_mb: number; analysis_timeout_s: number; accepted_formats: string[] };
}

export interface ScoringModel {
  cohort_confidence: { weighted: string; count_of: string; coverage_factor: string; severity_modulation: string; constants: Record<string, number>; notes: string[] };
  condition_score: { contribution: string; combination: string; name: string; role_factor: Record<string, number>; contribution_ceiling: number; reporting_floor: number; notes: string[] };
  evidence_levels: { bands: { level: EvidenceLevel; min_score: number }[]; coverage_caps: { when: string; effect: string }[]; direct_exemption: string; notes: string[] };
  urgency: { urgent_score_floor: number; rule: string };
  presentation_tiers: Record<Tier, string>;
}

export interface ConfigSummary {
  engine: { version: string; config: ConfigFingerprint };
  disease_master: {
    source_file: string;
    sheet: string;
    columns: string[];
    disease_count: number;
    skipped_rows: { name: string; reason: string }[];
    provenance_note: string;
    review_status: Record<string, number>;
    urgency_tiers: Record<string, number>;
    classification: Record<string, number>;
  };
  counts: Record<string, number>;
  validation: { ok: boolean; errors: number; warnings: number };
  scoring_model: ScoringModel;
  analysis_modes: Record<string, string>;
  exclusion_rules: { id: string; parameter: string; reason: string; vetoes_diseases: string[]; enabled: boolean }[];
  profiles: Record<string, string>[];
  unmappable: { note: string; conditions: { name: string; reason: string; would_need: string }[] };
  cohorts: {
    id: string;
    name: string;
    category: string | null;
    domain: string | null;
    description: string | null;
    profiles_touched: string[];
    cross_profile: boolean;
    cross_profile_rationale: string | null;
    mode: string;
    evidence: Citation[];
    diseases: { name: string; role: string; weight: number; dm_basis: string }[];
    expected_parameters: string[];
    source_file: string;
  }[];
  parameters: { id: string; name: string; profile: string | null; type: string; unit: string | null; alias_count: number; derived: boolean }[];
}

export interface ApiErrorBody {
  detail: string;
  error: { code: string; message: string; hint: string | null };
  request_id: string | null;
  document?: DocumentVerdict;
  summary?: Partial<Summary>;
  warnings?: string[];
  source_file?: string;
}
