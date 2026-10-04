/* The beginner view: Summary -> What needs attention -> What it means -> What to do next.
 *
 * Written for someone who has never read a lab report. Every value comes from the
 * engine's response; the only words added here are plain descriptions of states the
 * engine already assigned. Explanations of conditions are quoted verbatim from the
 * medical reference (the Disease Master's "Definition" column), never written here. */

import { useState } from "react";

import type { Analysis, DiseaseRisk, Recommendation } from "../../api/types";
import { classifyResults, MATCH_WORD, STEP_GROUP, type Level, type ResultItem } from "../../lib/classify";
import { num, plural, rangePosition, refText } from "../../lib/format";
import { Icon } from "../ui";
import { riskName, type Index } from "./model";

const LEVEL_WORD: Record<Level, string> = { important: "Important", attention: "Needs attention", normal: "Normal" };
const LEVEL_HELP: Record<Level, string> = {
  important: "Far outside the normal range, or part of a finding that needs prompt care.",
  attention: "Outside the normal range, or past a level doctors watch for.",
  normal: "Inside the normal range for this test.",
};

/* ------------------------------------------------------------------ pieces */

export function LevelTag({ level }: { level: Level }) {
  return <span className={`lvl lvl-${level}`}>{LEVEL_WORD[level]}</span>;
}

function valueWithUnit(value: unknown, unit: string | null) {
  return (
    <>
      <span className="num">{num(value)}</span>
      {typeof value === "number" && unit ? <span className="unit"> {unit}</span> : null}
    </>
  );
}

/** Where the value sits against its normal range - drawn only for a two-sided range. */
function RangeLine({ item }: { item: ResultItem }) {
  const pos = rangePosition(item.value, item.low, item.high);
  if (!pos) return null;
  return (
    <div className="rline" aria-hidden="true">
      <div className="rline-track">
        <span className="rline-band" style={{ left: `${pos.low * 100}%`, width: `${(pos.high - pos.low) * 100}%` }} />
        <span className={`rline-dot lvl-dot-${item.level}`} style={{ left: `${pos.value * 100}%` }} />
      </div>
      <div className="rline-scale">
        <span style={{ left: `${pos.low * 100}%` }}>{num(item.low)}</span>
        <span style={{ left: `${pos.high * 100}%` }}>{num(item.high)}</span>
      </div>
    </div>
  );
}

function normalRangeText(item: ResultItem): string {
  const r = refText(item.low, item.high);
  if (!r) return "No normal range given";
  const unit = typeof item.value === "number" && item.unit ? ` ${item.unit}` : "";
  if (item.low !== null && item.high !== null) return `Normal range ${r}${unit}`;
  return item.high !== null ? `Normal: below ${num(item.high)}${unit}` : `Normal: above ${num(item.low)}${unit}`;
}

function ResultRow({ item, extra = false }: { item: ResultItem; extra?: boolean }) {
  return (
    <li className={`rrow rrow-${item.level}${extra ? " extra" : ""}`}>
      <div className="rrow-main">
        <div className="rrow-head">
          <LevelTag level={item.level} />
          <span className="rrow-name">{item.name}</span>
        </div>
        <p className="rrow-reason">{item.reason}</p>
        <p className="rrow-meta">
          {item.group && <span>{item.group}</span>}
          {item.medicalTerm && <span>Lab term: {item.medicalTerm}</span>}
          {item.derived && <span>Calculated, not measured</span>}
        </p>
      </div>
      <div className="rrow-value">
        <div className="rrow-yours">
          <span className="rrow-label">Your result</span>
          <span className="rrow-num">{valueWithUnit(item.value, item.unit)}</span>
        </div>
        <span className="rrow-range">{normalRangeText(item)}</span>
        <RangeLine item={item} />
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ summary */

export function Summary({ analysis: a, groups, onJump, onRerun, rerunning }: {
  analysis: Analysis;
  groups: ReturnType<typeof classifyResults>;
  onJump: (id: string) => void;
  onRerun: (sex: "male" | "female") => void;
  rerunning: boolean;
}) {
  const nImp = groups.important.length;
  const nAtt = groups.attention.length;
  const nNorm = groups.normal.length;
  const total = nImp + nAtt + nNorm;
  const urgent = a.urgent_findings;
  const urgentStep = a.recommendations.find((r) => r.priority === "urgent");

  // The headline is the one-line overview; the red "Contact a doctor today" block right
  // under it carries the urgency, so the two never say the same thing twice.
  const headline = nImp
      ? "Some results are far outside the normal range."
      : nAtt
        ? "A few results are outside the normal range."
        : total
          ? "All of your results are in the normal range."
          : "No results could be read from this report.";

  return (
    <section id="summary" className="simple-sec" aria-labelledby="summary-title">
      {a.document?.incomplete && (
        <div className="callout callout-urgent" role="alert">
          <Icon name="alert" />
          <div>
            <b>Analysis INCOMPLETE.</b> {a.document.incomplete.message}
          </div>
        </div>
      )}

      <h2 id="summary-title" className="headline">
        {headline}
      </h2>
      <p className="headline-sub">
        We checked {plural(total, "result")} from your report against their normal ranges.
        {total > 0 && total < 8 && " Only a few results could be read, so this is a partial picture."}
      </p>

      {urgent.length > 0 && (
        <div className="today" role="alert">
          <Icon name="alert" className="icon today-icon" />
          <div>
            <p className="today-title">Contact a doctor today</p>
            <p>
              {urgentStep?.text.split(" The result behind this:")[0] ??
                "One or more results need same-day medical assessment. Contact a doctor or emergency service now."}
            </p>
            <ul className="today-list">
              {urgent.map((r) => (
                <li key={r.disease_id}>
                  <b>{riskName(r)}</b>
                  {": "}
                  {r.triggering_parameters
                    .filter((t) => !t.discounted)
                    .slice(0, 2)
                    .map((t) => {
                      const p = a.parameters.find((x) => x.parameter_id === t.parameter_id);
                      const v = p?.value ?? p?.status;
                      return `${t.name} ${num(v)}${typeof v === "number" && p?.unit ? " " + p.unit : ""}`;
                    })
                    .join(", ")}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ul className="tally" aria-label="Your results at a glance">
        {(["important", "attention", "normal"] as const).map((lvl) => {
          const n = lvl === "important" ? nImp : lvl === "attention" ? nAtt : nNorm;
          return (
            <li key={lvl}>
              <button
                type="button"
                className={`tally-item tally-${lvl}`}
                onClick={() => onJump(lvl === "normal" ? "normal" : "attention")}
                disabled={n === 0}
              >
                <span className="tally-n num">{n}</span>
                <span className="tally-word">
                  <LevelTag level={lvl} />
                  <span className="tally-help">{LEVEL_HELP[lvl]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {!a.patient.sex && (
        <div className="callout callout-info">
          <Icon name="info" />
          <div>
            <b>Your sex isn't stated in this report.</b> Some normal ranges are different for men and women. For more accurate results, choose one:{" "}
            <span className="rerun no-print">
              <button type="button" className="btn btn-sm" disabled={rerunning} onClick={() => onRerun("female")}>
                Female
              </button>{" "}
              <button type="button" className="btn btn-sm" disabled={rerunning} onClick={() => onRerun("male")}>
                Male
              </button>
              {rerunning && <span className="spinner" aria-label="Updating" />}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ attention */

const FIRST_RESULTS = 5;

export function NeedsAttention({ groups, labNotes }: { groups: ReturnType<typeof classifyResults>; labNotes: number }) {
  const [all, setAll] = useState(false);
  const flagged = [...groups.important, ...groups.attention];
  const hidden = all ? 0 : Math.max(0, flagged.length - FIRST_RESULTS);
  return (
    <section id="attention" className="simple-sec" aria-labelledby="attention-title">
      <h2 id="attention-title" className="simple-h">
        What needs attention
      </h2>
      {flagged.length ? (
        <>
          <p className="simple-lead">
            Your value is shown beside its normal range. The most important results come first.
            {hidden > 0 && <span className="no-print"> Here are the first {FIRST_RESULTS} of {flagged.length}.</span>}
          </p>
          <ul className="rrows">
            {flagged.map((i, n) => (
              <ResultRow key={i.id} item={i} extra={!all && n >= FIRST_RESULTS} />
            ))}
          </ul>
          {flagged.length > FIRST_RESULTS && (
            <button type="button" className="btn show-more" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${flagged.length} results that need attention`}
            </button>
          )}
        </>
      ) : (
        <div className="calm">
          <Icon name="check" />
          <p>Nothing in this report is outside its normal range.</p>
        </div>
      )}
      {labNotes > 0 && (
        <p className="simple-note">
          <Icon name="info" className="icon icon-xs" /> The lab also added a note to {plural(labNotes, "result")} (for example an unclear or borderline reading). Show the
          original report to your doctor; the details are under <i>See details</i>.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ meaning */

function MeaningCard({ r, ix, onExplain, extra }: { r: DiseaseRisk; ix: Index; onExplain: (id: string) => void; extra: boolean }) {
  const [more, setMore] = useState(false);
  const definition = r.dm_fields["Definition"];
  const urgent = ix.urgentIds.has(r.disease_id);
  const based = r.triggering_parameters.filter((t) => !t.discounted).slice(0, 4);
  // "Possibility, not a diagnosis" is said once, in the section introduction.
  const sentence =
    r.presentation_tier === "direct"
      ? "One of your results is in the range used to identify this."
      : r.presentation_tier === "derived"
        ? "A value calculated from your results is in the range linked to this."
        : "Several of your results together fit a pattern linked to this.";

  return (
    <li className={`mcard${urgent ? " is-urgent" : ""}${extra ? " extra" : ""}`}>
      <div className="mcard-top">
        <span className={`match match-${r.evidence_level}`}>{MATCH_WORD[r.evidence_level]}</span>
        {urgent && <span className="lvl lvl-important">Needs care today</span>}
      </div>
      <h3 className="mcard-title">{riskName(r)}</h3>
      <p className="mcard-sentence">{sentence}</p>
      {based.length > 0 && (
        <p className="mcard-based">
          Based on:{" "}
          {based.map((t) => {
            const p = ix.paramById.get(t.parameter_id);
            return (
              <span key={t.parameter_id} className="chip">
                {t.name} {p ? valueWithUnit(p.value ?? p.status, p.unit) : null}
              </span>
            );
          })}
        </p>
      )}
      {r.display_note && <p className="mcard-note">{r.display_note}</p>}
      <div className="mcard-actions">
        {definition && (
          <button type="button" className="linkish" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? "Hide the explanation" : "What is this?"}
          </button>
        )}
        <button type="button" className="linkish" onClick={() => onExplain(r.disease_id)}>
          See how this was worked out
        </button>
      </div>
      {definition && more && (
        <p className="mcard-what fade-in">
          {definition} <span className="muted xs">(From the medical reference this tool uses.)</span>
        </p>
      )}
    </li>
  );
}

export function WhatItMeans({ analysis: a, ix, onExplain }: { analysis: Analysis; ix: Index; onExplain: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const supported = a.disease_risks
    .filter((r) => r.presentation_tier !== "insufficient")
    .sort((x, y) => Number(ix.urgentIds.has(y.disease_id)) - Number(ix.urgentIds.has(x.disease_id)) || y.score - x.score);

  return (
    <section id="meaning" className="simple-sec" aria-labelledby="meaning-title">
      <h2 id="meaning-title" className="simple-h">
        What it means
      </h2>
      {supported.length ? (
        <>
          <p className="simple-lead">
            Some results, taken together, can point to a possible health concern. These are possibilities to discuss with a doctor, not diagnoses: only a
            doctor can confirm them. The strongest matches come first.
          </p>
          <ul className="mcards">
            {supported.map((r, i) => (
              <MeaningCard key={r.disease_id} r={r} ix={ix} onExplain={onExplain} extra={!all && i >= 4} />
            ))}
          </ul>
          {supported.length > 4 && (
            <button type="button" className="btn btn-sm show-more" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show ${supported.length - 4} more`}
            </button>
          )}
        </>
      ) : (
        <div className="calm">
          <Icon name="check" />
          <p>Your results don't match any of the health patterns this tool checks for.</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ next steps */

function StepItem({ r, extra }: { r: Recommendation; extra: boolean }) {
  return (
    <li className={`nstep${extra ? " extra" : ""}`}>
      <p className="nstep-text">{r.text}</p>
      {(r.finding_display || r.values.length > 0) && (
        <p className="nstep-about">
          {r.finding_display && r.finding_kind !== "general" && <span>About: {r.finding_display}</span>}
          {r.values.slice(0, 3).map((v) => (
            <span key={v.parameter_id} className="chip">
              {v.name} {valueWithUnit(v.value, v.unit)}
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

export function NextSteps({ analysis: a }: { analysis: Analysis }) {
  const [all, setAll] = useState(false);
  const order = ["urgent", "high", "medium", "low"] as const;
  const sorted = order.flatMap((p) => a.recommendations.filter((r) => r.priority === p));
  const LIMIT = 5;
  // Items past the limit stay in the page (printing always includes them), hidden on
  // screen until "Show all".
  const extra = new Set(all ? [] : sorted.slice(LIMIT).map((r) => r.id));

  return (
    <section id="next" className="simple-sec" aria-labelledby="next-title">
      <h2 id="next-title" className="simple-h">
        What to do next
      </h2>
      <p className="simple-lead">Suggestions from this tool, most important first. Your doctor decides what is right for you.</p>
      {order.map((p) => {
        const list = sorted.filter((r) => r.priority === p);
        if (!list.length) return null;
        const allExtra = list.every((r) => extra.has(r.id));
        return (
          <div key={p} className={`ngroup ngroup-${p}${allExtra ? " extra" : ""}`}>
            <h3 className="ngroup-title">
              {STEP_GROUP[p].title}
              <span className="ngroup-help">{STEP_GROUP[p].help}</span>
            </h3>
            <ol className="nsteps">
              {list.map((r) => (
                <StepItem key={r.id} r={r} extra={extra.has(r.id)} />
              ))}
            </ol>
          </div>
        );
      })}
      {sorted.length > LIMIT && (
        <button type="button" className="btn btn-sm show-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${sorted.length} suggestions`}
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ normal */

export function NormalResults({ items }: { items: ResultItem[] }) {
  if (!items.length) return null;
  return (
    <section id="normal" className="simple-sec" aria-labelledby="normal-title">
      <details className="normal-box print-open">
        <summary>
          <h2 id="normal-title" className="simple-h simple-h-inline">
            Normal results
          </h2>
          <span className="normal-count">
            <LevelTag level="normal" /> {plural(items.length, "result")} in the normal range. Show them
          </span>
        </summary>
        <ul className="nlist">
          {items.map((i) => (
            <li key={i.id}>
              <span className="nlist-name">{i.name}</span>
              <span className="nlist-val">{valueWithUnit(i.value, i.unit)}</span>
              <span className="nlist-range">{refText(i.low, i.high) ?? "—"}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
