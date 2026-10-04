/* Print, copy and download helpers shared by the header and the details panel. */

import type { Analysis } from "../../api/types";
import { classifyResults, MATCH_WORD } from "../../lib/classify";
import { dateTime, num } from "../../lib/format";
import { riskName } from "./model";

/** Print, or save as PDF from the print dialog. The mode is read by the page's
 *  beforeprint handler (Results) and by print.css; Ctrl+P without a mode prints in full. */
export function printReport(mode: "summary" | "full") {
  const root = document.documentElement;
  root.dataset.printMode = mode;
  const clear = () => {
    delete root.dataset.printMode;
    window.removeEventListener("afterprint", clear);
  };
  window.addEventListener("afterprint", clear);
  window.print();
}

/** A plain-text summary in the same words as the page. */
export function textSummary(a: Analysis): string {
  const g = classifyResults(a);
  const p = a.patient;
  const line = (label: string, items: ReturnType<typeof classifyResults>["important"]) =>
    items.length
      ? [`${label}:`, ...items.map((i) => `  - ${i.name}: ${num(i.value)}${typeof i.value === "number" && i.unit ? " " + i.unit : ""} — ${i.reason}`)]
      : [];
  return [
    `LabScan lab report summary — ${a.source_file}`,
    `Checked ${dateTime(a.generated_at)}${p.name ? ` · ${p.name}` : ""}${p.sex ? ` · ${p.sex}` : ""}${p.age ? ` · ${num(p.age)} years` : ""}`,
    "",
    a.urgent_findings.length ? "CONTACT A DOCTOR TODAY: " + a.urgent_findings.map(riskName).join("; ") : "",
    `${g.important.length} important, ${g.attention.length} need attention, ${g.normal.length} normal.`,
    "",
    ...line("Important", g.important),
    ...line("Needs attention", g.attention),
    "",
    "What it may mean (possibilities to discuss, not diagnoses):",
    ...a.disease_risks
      .filter((r) => r.presentation_tier !== "insufficient")
      .map((r) => `  - ${riskName(r)} (${MATCH_WORD[r.evidence_level]})`),
    "",
    "What to do next:",
    ...a.recommendations.slice(0, 6).map((r) => `  - ${r.text}`),
    "",
    a.disclaimer,
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
}

export function downloadJson(a: Analysis) {
  const blob = new Blob([JSON.stringify(a, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${a.source_file.replace(/\.[^.]+$/, "")}.analysis.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
