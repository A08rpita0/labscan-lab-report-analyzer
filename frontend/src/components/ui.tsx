import { useState, type ReactNode } from "react";
import type { EvidenceLevel } from "../api/types";
import { LEVEL_WORD } from "../lib/labels";

/* ------------------------------------------------------------------ icons */

const PATHS: Record<string, ReactNode> = {
  upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  check: <path d="m5 12 5 5L20 7" />,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  back: <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  download: <><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></>,
  print: <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></>,
  graph: <><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 7l3.5 3.5M7 17l3.5-3.5M14 12h3" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  flask: <><path d="M9 3h6" /><path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7.5 15h9" /></>,
  shield: <><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  code: <><path d="m8 7-5 5 5 5" /><path d="m16 7 5 5-5 5" /></>,
  route: <><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 20v-4h-4" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  expand: <><path d="m7 9 5-5 5 5" /><path d="m7 15 5 5 5-5" /></>,
  collapse: <><path d="m7 4 5 5 5-5" /><path d="m7 20 5-5 5 5" /></>,
};

export function Icon({ name, className = "icon", label }: { name: keyof typeof PATHS | string; className?: string; label?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      {PATHS[name] ?? null}
    </svg>
  );
}

/* ------------------------------------------------------------------ evidence + status */

export function EvidenceLevelTag({ level, compact = false }: { level: EvidenceLevel; compact?: boolean }) {
  return (
    <span className={`ev ev-${level}`} title={`Evidence level: ${level}. Strength of the configured match, not the likelihood of disease.`}>
      <span className="ev-pips" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {compact ? level : LEVEL_WORD[level]}
    </span>
  );
}

export function StatusTag({ kind, children }: { kind: "high" | "low" | "positive" | "normal" | "rule" | "critical"; children: ReactNode }) {
  return <span className={`status status-${kind}`}>{children}</span>;
}

export function Tip({ children, label = "?" }: { children: ReactNode; label?: string }) {
  return (
    <span className="tip" tabIndex={0} role="note">
      {label}
      <span className="tip-body" role="tooltip">
        {children}
      </span>
    </span>
  );
}

export function Meter({ value, tone = "blue", label }: { value: number; tone?: "blue" | "ink" | "slate"; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={`meter meter-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(v.toFixed(3))} aria-label={label}>
      <i style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ copy */

export function CopyButton({ text, label = "Copy", className = "btn btn-sm" }: { text: () => string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text());
          setState("done");
        } catch {
          setState("failed");
        }
        window.setTimeout(() => setState("idle"), 1600);
      }}
    >
      <Icon name={state === "done" ? "check" : "copy"} />
      <span aria-live="polite">{state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ section frame */

export function Section({ id, title, lead, actions, children }: {
  id: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="rsection" aria-labelledby={`${id}-title`}>
      <header className="rsection-head">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          {lead && <p className="rsection-lead">{lead}</p>}
        </div>
        {actions && <div className="rsection-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ icon = "check", title, children, tone = "neutral" }: { icon?: string; title: string; children?: ReactNode; tone?: "neutral" | "ok" }) {
  return (
    <div className={`empty empty-${tone}`}>
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <div>
        <p className="empty-title">{title}</p>
        {children && <div className="empty-body">{children}</div>}
      </div>
    </div>
  );
}
