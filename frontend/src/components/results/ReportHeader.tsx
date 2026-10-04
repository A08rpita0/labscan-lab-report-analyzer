import type { Analysis } from "../../api/types";
import type { InputRef } from "../../App";
import { num } from "../../lib/format";
import { Icon } from "../ui";
import { printReport } from "./exporters";

/** Whose report, from which file, and the two things a reader wants to do next.
 *  Technical identifiers (engine version, configuration fingerprint, data coverage)
 *  live in the technical audit under "See details". */
export function ReportHeader({ analysis: a, input, onNew }: { analysis: Analysis; input: InputRef; onNew: () => void }) {
  const p = a.patient;
  const facts = [
    p.name,
    p.sex ? p.sex[0].toUpperCase() + p.sex.slice(1) : null,
    p.age !== null && p.age !== undefined ? `${num(p.age)} years` : null,
    p.report_date ? `Report date ${p.report_date}` : null,
  ].filter(Boolean) as string[];

  return (
    <header className="report-header">
      <div className="simple-wrap rh-top">
        <div className="rh-title">
          <h1>Your results</h1>
          <p className="rh-sub">
            {input.kind === "sample" && <span className="badge badge-blue">Example report</span>}
            <span>
              From <span className="mono">{a.source_file}</span>
            </span>
          </p>
          {facts.length > 0 && (
            <ul className="rh-facts" aria-label="Patient details from the report">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="rh-actions no-print">
          <button type="button" className="btn" onClick={() => printReport("summary")}>
            <Icon name="print" /> <span className="lbl-long">Print or save as PDF</span>
            <span className="lbl-short" aria-hidden="true">Print / PDF</span>
          </button>
          <button type="button" className="btn" onClick={onNew}>
            <Icon name="upload" /> <span className="lbl-long">Check another report</span>
            <span className="lbl-short" aria-hidden="true">New report</span>
          </button>
        </div>
      </div>
    </header>
  );
}
