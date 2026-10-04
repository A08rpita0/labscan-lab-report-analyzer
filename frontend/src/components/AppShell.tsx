import type { ReactNode } from "react";
import type { Health } from "../api/types";
import type { Route } from "../lib/hooks";
import { Icon } from "./ui";

/** The LabScan mark: a sample tube whose reading line runs out to a single point -
 *  together an "L" for Lab - with the point in the amber used for "spot what needs attention".
 *  The same drawing is public/favicon.svg; keep the two in step. */
function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#16263d" />
      <g transform="translate(-1 1.5)">
        <g fill="none" stroke="#8fb2df" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 5.5h9" />
          <path d="M8 5.5v15a3 3 0 0 0 6 0v-15" />
          <path d="M14 20.5h7.5" opacity=".55" />
        </g>
        <path d="M8 13h6v7.5a3 3 0 0 1-6 0z" fill="#8fb2df" />
        <circle cx="24.5" cy="20.5" r="3.4" fill="#e0a947" stroke="#16263d" strokeWidth="1.6" />
      </g>
    </svg>
  );
}

export function AppShell({ route, go, health, hasAnalysis, children }: {
  route: Route;
  go: (r: Route) => void;
  health: Health | null;
  hasAnalysis: boolean;
  children: ReactNode;
}) {
  const link = (r: Route, label: string, short: string, disabled = false) => (
    <a
      href={r === "home" ? "#/" : `#/${r}`}
      className={`nav-link${route === r ? " is-active" : ""}`}
      aria-label={label}
      aria-current={route === r ? "page" : undefined}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) go(r);
      }}
    >
      <span className="nav-full">{label}</span>
      <span className="nav-short" aria-hidden="true">
        {short}
      </span>
    </a>
  );

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <a
            className="brand"
            aria-label="LabScan home"
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              go("home");
            }}
          >
            <Mark />
            <span className="brand-text">
              <span className="brand-name">LabScan</span>
              <span className="brand-sub">Understand your lab report. Spot what needs attention.</span>
            </span>
          </a>
          <nav className="nav" aria-label="Primary">
            {link("home", "Analyse", "Analyse")}
            {hasAnalysis && link("analysis", "Your results", "Results")}
            {link("system", "How it works", "How it works")}
          </nav>
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <p className="footer-claim">
            LabScan <strong>does not diagnose</strong>. Always discuss your results with a doctor.
          </p>
          <p className="footer-meta">
            {health ? (
              <>
                Engine v{health.version}
                {health.status !== "ok" && <b className="footer-warn"> (configuration error)</b>}
              </>
            ) : (
              "Connecting…"
            )}
            <a href="/docs" target="_blank" rel="noopener">
              API for developers <Icon name="external" className="icon icon-xs" />
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
