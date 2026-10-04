/* Lookups derived once per analysis, so sections render without re-scanning lists. */

import type { Analysis, CohortHit, DiseaseRisk, Parameter, ReasoningTrace, Recommendation, Tier } from "../../api/types";

export interface Index {
  paramById: Map<string, Parameter>;
  riskById: Map<string, DiseaseRisk>;
  riskByName: Map<string, DiseaseRisk>;
  traceById: Map<string, ReasoningTrace>;
  recById: Map<string, Recommendation>;
  cohortById: Map<string, CohortHit>;
  byTier: Record<Tier, DiseaseRisk[]>;
  urgentIds: Set<string>;
  reviewStatus: Record<string, number>;
  firedCitations: string[];
  name: (pid: string) => string;
  isLinked: (pid: string) => boolean;
  recsForRisk: (r: DiseaseRisk) => Recommendation[];
}

export function buildIndex(a: Analysis): Index {
  const paramById = new Map(a.parameters.map((p) => [p.parameter_id, p]));
  const riskById = new Map(a.disease_risks.map((r) => [r.disease_id, r]));
  const riskByName = new Map(a.disease_risks.map((r) => [r.name, r]));
  const traceById = new Map((a.explainability?.traces ?? []).map((t) => [t.disease_id, t]));
  const recById = new Map(a.recommendations.map((r) => [r.id, r]));
  const cohortById = new Map(a.cohorts.map((c) => [c.cohort_id, c]));
  const byTier: Record<Tier, DiseaseRisk[]> = { direct: [], derived: [], pattern: [], insufficient: [] };
  for (const r of a.disease_risks) byTier[r.presentation_tier]?.push(r);
  const reviewStatus: Record<string, number> = {};
  for (const r of a.disease_risks) {
    const k = r.review_status || "not stated";
    reviewStatus[k] = (reviewStatus[k] ?? 0) + 1;
  }
  const firedCitations = [...new Set(a.cohorts.flatMap((c) => c.evidence.map((e) => e.citation)))];
  const names = a.explainability?.parameter_names ?? {};
  const links = a.explainability?.parameter_links ?? {};
  const graphEdges = a.explainability?.graph.edges ?? [];

  // Plan steps connected to a signal in the evidence graph (titled by it, sourced from
  // it, or requesting its missing tests) - the graph is the single record of that link.
  const recsByRisk = new Map<string, Recommendation[]>();
  for (const e of graphEdges) {
    if (e.source.startsWith("d:") && e.target.startsWith("a:")) {
      const rec = recById.get(e.target.slice(2));
      if (!rec) continue;
      const list = recsByRisk.get(e.source.slice(2)) ?? [];
      if (!list.includes(rec)) list.push(rec);
      recsByRisk.set(e.source.slice(2), list);
    }
  }

  return {
    paramById,
    riskById,
    riskByName,
    traceById,
    recById,
    cohortById,
    byTier,
    urgentIds: new Set(a.urgent_findings.map((r) => r.disease_id)),
    reviewStatus,
    firedCitations,
    name: (pid) => paramById.get(pid)?.name ?? names[pid] ?? pid,
    isLinked: (pid) => {
      const l = links[pid];
      return !!l && (l.cohorts.length > 0 || l.conditions.length > 0);
    },
    recsForRisk: (r) => recsByRisk.get(r.disease_id) ?? [],
  };
}

export function riskName(r: DiseaseRisk): string {
  return r.display_name || r.name;
}
