/* Filtering and sorting for the laboratory results explorer. Pure, so it is unit-tested
 * and so the component only renders. */

import type { Parameter } from "../api/types";

export type StatusFilter = "all" | "abnormal" | "normal" | "rule";
export type LinkFilter = "all" | "linked" | "unlinked";
export type SortKey = "attention" | "name" | "profile" | "severity";

export interface ExplorerQuery {
  text: string;
  status: StatusFilter;
  profile: string; // "" = all
  link: LinkFilter;
  sort: SortKey;
}

export const DEFAULT_QUERY: ExplorerQuery = { text: "", status: "all", profile: "", link: "all", sort: "attention" };

/** In range by the laboratory's interval, yet a configured rule fired on it. */
export function firedWhileInRange(p: Parameter): boolean {
  return !p.abnormal && (p.triggered_bands?.length ?? 0) > 0;
}

export function statusOf(p: Parameter): "abnormal" | "rule" | "normal" {
  if (p.abnormal) return "abnormal";
  if (firedWhileInRange(p)) return "rule";
  return "normal";
}

function matches(p: Parameter, text: string): boolean {
  if (!text) return true;
  const hay = [p.name, p.profile, p.parameter_id, p.raw?.raw_name, p.grade_label, p.unit]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

const STATUS_RANK = { abnormal: 0, rule: 1, normal: 2 } as const;

export function filterParameters(params: Parameter[], q: ExplorerQuery, linked: (pid: string) => boolean): Parameter[] {
  const out = params.filter((p) => {
    if (!matches(p, q.text.trim())) return false;
    if (q.profile && (p.profile || "Other") !== q.profile) return false;
    const s = statusOf(p);
    if (q.status === "abnormal" && s !== "abnormal") return false;
    if (q.status === "normal" && s !== "normal") return false;
    if (q.status === "rule" && s !== "rule") return false;
    if (q.link === "linked" && !linked(p.parameter_id)) return false;
    if (q.link === "unlinked" && linked(p.parameter_id)) return false;
    return true;
  });
  const byName = (a: Parameter, b: Parameter) => a.name.localeCompare(b.name);
  switch (q.sort) {
    case "name":
      return out.sort(byName);
    case "profile":
      return out.sort((a, b) => (a.profile || "").localeCompare(b.profile || "") || byName(a, b));
    case "severity":
      return out.sort((a, b) => b.severity_score - a.severity_score || byName(a, b));
    default:
      return out.sort(
        (a, b) => STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)] || b.severity_score - a.severity_score || byName(a, b),
      );
  }
}

export function profilesOf(params: Parameter[]): { profile: string; total: number; abnormal: number }[] {
  const m = new Map<string, { total: number; abnormal: number }>();
  for (const p of params) {
    const k = p.profile || "Other";
    const e = m.get(k) ?? { total: 0, abnormal: 0 };
    e.total++;
    if (p.abnormal) e.abnormal++;
    m.set(k, e);
  }
  return [...m.entries()]
    .map(([profile, v]) => ({ profile, ...v }))
    .sort((a, b) => b.total - a.total || a.profile.localeCompare(b.profile));
}
