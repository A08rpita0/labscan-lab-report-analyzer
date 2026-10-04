# Architecture

LabScan is a deterministic, configuration-driven evidence pipeline with
an explainability layer and a typed web client. This document covers what each part is
responsible for, how data and evidence move through it, how it fails, and why it is built
this way.

---

## 1. System overview

```
┌─────────────────────────────── browser ────────────────────────────────┐
│ React + TypeScript client (frontend/ → web/)                           │
│   landing · results (10 sections) · evidence graph · system reference  │
└──────────────┬──────────────────────────────────────────▲──────────────┘
               │ multipart upload / sample name           │ JSON analysis
┌──────────────▼──────────────────────────────────────────┴──────────────┐
│ app.py (FastAPI)                                                        │
│   UploadLimit (pre-parse size cap) · request id · security headers ·    │
│   gzip · validation · error envelope · worker thread + timeout          │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ bytes, filename, sex?, age?
┌──────────────▼──────────────────────────────────────────────────────────┐
│ engine.pipeline.Pipeline.run   (one instance per worker thread)         │
│  extract → normalize → doccheck → gatekeeper → cohorts → risk →         │
│  findings → recommend → explain → assemble       (each stage timed)     │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ read-only, validated once per process
┌──────────────▼──────────────────────────────────────────────────────────┐
│ engine.config.Config ← config/*.json  (content-hashed fingerprint)      │
└─────────────────────────────────────────────────────────────────────────┘
```

No database, no external services, no model weights. A process holds the validated
configuration and nothing else between requests.

## 2. Module responsibilities

| Module | Responsibility | Key outputs |
|---|---|---|
| `engine/config.py` | Load all JSON config, build the alias index, validate every cross-reference (unknown parameter, missing citation, link without `dm_basis`, a rule that could fire on an all-normal panel…), compute the content fingerprint | `Config`, `validation`, `fingerprint` |
| `engine/extract.py`, `engine/layout.py` | Bytes → `RawObservation[]` + `PatientContext`. PDF word-geometry rows, value-anchored row parsing, CSV/TXT, recursive JSON; text decoding (BOM/UTF-16/cp1252) | observations with `source_path`, `origin`, `section` |
| `engine/ocr.py` | Optional OCR for image-only pages; off unless `DRE_ENABLE_OCR=1` and the dependencies are installed | — |
| `engine/normalize.py` | Alias resolution, unit conversion, reference selection, duplicate resolution, derived values, abnormality grading, data-quality flags | `StandardizedPatient` |
| `engine/doccheck.py` | Is this a laboratory report at all? `ok` / `unreadable` / `not_a_report`, plus an `incomplete` marker for partly scanned PDFs | verdict object |
| `engine/gatekeeper.py` | Hard exclusions from explicit negative definitive markers | `Veto[]` |
| `engine/cohorts.py` | Evaluate all 82 rules (`weighted` / `count_of`), redundancy and input-redundancy discounting, confidence with a full breakdown | `CohortHit[]`, not-assessable list, suppressed list |
| `engine/risk.py` | Pool links per Disease Master row, link gating (`requires_any`), support damping, noisy-OR, bands, coverage caps, presentation tier, urgency | `DiseaseRisk[]` |
| `engine/findings.py` | Every abnormal or threshold-crossing result as a finding in its own right; laboratory-marked results not graded abnormal | lab findings, lab-noted findings |
| `engine/recommend.py` | Action plan from triage rules, Disease Master guidance, action libraries, coverage gaps, record gaps; merge per subject; cite every abnormal result | `Recommendation[]` with `trace` |
| `engine/explain.py` | Evidence graph, reasoning traces, rule-evaluation audit, condition candidates, parameter links, scoring model | `explainability` block |
| `engine/pipeline.py` | Wire the stages, time each one, assemble the response | analysis JSON + `run` timings |
| `app.py` | HTTP boundary: limits, validation, errors, headers, logging, samples, configuration endpoints, static client | — |

## 3. Data flow

1. **Extraction** produces raw observations exactly as printed — name, value, unit, range,
   flag — with where each came from (`$.laboratory.panels[1].tests[1]`, `page 2 line 14`).
2. **Normalization** maps each to a canonical parameter or records it as unmapped (a
   result-shaped unknown) or a document field (an envelope scalar — never counted as a lost
   result). Impossible values are rejected and listed; nothing is imputed.
3. **Document check** refuses non-reports before any inference, so an unrelated file can
   never produce an empty-looking "all normal" dashboard.
4. **Exclusion gates** run before scoring so a vetoed condition reaches neither scoring nor
   recommendations, but the audit records what would have fired.
5. **Cohorts → risk → findings → recommendations** each consume the previous stage's
   records and add their own trace fields.
6. **Explainability** reads those records into a graph and traces; **assembly** serialises
   everything. Timings go into a separate `run` block.

## 4. API flow

```
POST /api/analyse
  UploadLimit: Content-Length > limit? → 413 (before parsing); stream counted otherwise
  form parse (in memory; spool threshold above the limit)
  _safe_name(filename) → extension allowlist → 415
  _clean_sex / _clean_age → 422 invalid_sex / invalid_age
  _check_content: empty → 400, .pdf without %PDF- → 422 corrupt_pdf, bad JSON → 422 invalid_json
  anyio.to_thread.run_sync(pipeline.run) under fail_after(timeout) → 504 analysis_timeout
  unexpected exception → logged with traceback server-side → 422 analysis_failed (no detail)
  document not a report → 422 not_a_report / unreadable + the verdict object
  200 → analysis JSON (Cache-Control: no-store, gzip)
```

`/api/analyse/sample` resolves the name against `samples/manifest.toml` only — never as a
path — then follows the same path from the worker thread onward.

## 5. Evidence flow

```
parameter value
   │  evaluate_condition(rule.condition)          → TriggerHit(weight, effective_weight)
   │  severity modulation, redundancy discount
   ▼
pattern (cohort) confidence = fired / (required + measured support) × coverage factor
   │  each link: weight × confidence × role factor × support damping
   │  (requires_any gating; only the strongest link per cohort counts)
   ▼
Disease Master row score = 1 − Π(1 − min(0.97, contribution))
   │  band → coverage cap / differential cap / unconfirmed-reading cap → level
   │  direct criterion?  derived value?  → presentation tier
   │  urgency tier, cohort override, urgent floor on the score
   ▼
recommendations (titled by the condition, sourced from the cohort, citing the values)
```

Every arrow above is a field in the response, which is why the evidence graph can be built
without inference and tested edge by edge (`tests/test_explainability.py`).

## 6. Disease Master interaction

- The workbook is converted, not interpreted: `tools/build_disease_master.py` keeps all 22
  columns verbatim and adds only mechanical helpers (profile list, parsed urgency stem,
  marker tokens, a slug id).
- Rules never reference a row by anything but its exact name; a renamed row fails
  validation at start-up rather than silently dropping a link.
- Every link quotes the Disease Master field that justifies it (`dm_basis`), enforced as a
  configuration error.
- `config/presentation.json` controls how a row may be *named* given the evidence type —
  raised LDL is presented as a "Cardiovascular risk signal", not as coronary artery disease;
  the row name is kept for audit.
- `config/unmappable.json` lists rows that laboratory data alone cannot raise, with the
  reason, so coverage is measured against what is actually mappable.
- `tools/dm_audit.py` checks each row's own wording against how the engine infers it;
  decisions are recorded in `config/dm_review.json`.

## 7. Frontend / backend interaction

- The client is a pure consumer of the API. Clinical content (thresholds, citations,
  Disease Master text, recommendations) is never stored in the client; interface wording
  for enum values lives in `lib/labels.ts`.
- `api/types.ts` mirrors the response; `api/client.ts` normalises every failure into an
  `ApiError` with a code, message and hint — server errors, client timeouts (90 s,
  `AbortController`), network failures and cancellation alike.
- The client repeats the cheap checks (extension, empty, size) for instant feedback; the
  server repeats every one of them.
- Layout of the evidence graph is computed client-side from the backend's nodes and edges
  (`lib/graphLayout.ts`): the backend owns the relationships, the client owns geometry.
- The build output is committed to `web/` so deployment needs no Node toolchain;
  `tests/test_extraction.py` checks that the committed bundle contains the safety-critical
  UI states.

## 8. Failure handling

| Failure | Behaviour |
|---|---|
| Configuration invalid | Each worker logs `startup config_ok=False` at boot; `/api/health` reports `config_error` with the exact errors and the UI shows a banner (the optional Docker build also refuses to build) |
| Service still starting / asleep | Start-up requests wait up to 45 s; on failure the page says the service could not be reached and offers a retry — never "no samples" |
| Unsupported / empty / oversized / corrupt file | Specific 4xx code with a hint; nothing analysed |
| Not a report / fully scanned PDF | 422 with the document verdict (characters read, observations, recognised parameters) |
| Partly scanned PDF | Analysed, marked `incomplete`, banner shown first |
| Unrecognised tests, rejected values, duplicates | Analysed; each listed with the reason in coverage and audit |
| Sex not stated | Widest interval used and annotated; one-click re-run with a stated sex |
| Readings far outside plausible range | Kept, flagged `suspicious`; a signal resting only on them is held at Limited (urgent ones keep their level) |
| Analysis too slow | 504 after `DRE_ANALYSIS_TIMEOUT_S`; the worker is abandoned, the event loop is never blocked |
| Unexpected exception | Logged server-side with a request id; the client receives a generic message and the id |
| Network failure / client timeout | Client-side `ApiError` with retry |

## 9. Security decisions

- **No persistence**: uploads are read into memory and dropped with the request; the
  multipart spool threshold is raised so no temporary file is written.
- **Size limit before parsing**, by declared length and by streamed count.
- **No path from user input**: samples are resolved through a manifest allowlist; uploaded
  filenames are reduced to a bounded, control-character-free basename and only echoed.
- **No information leakage**: one error envelope, no exception text, no tracebacks.
- **Browser hardening**: CSP without inline script/style, `nosniff`, frame denial, no
  referrer; analysis responses `no-store`. MIME types are pinned so `nosniff` cannot break
  the client on hosts whose registry maps `.js` to `text/plain`.
- **Privacy-safe logs**: route, status, byte count, counts and timings only.
- **Out of scope here**: authentication, rate limiting, TLS — see `DEPLOY.md`.

## 10. Scalability considerations

- CPU-bound and stateless per request: scale with `WEB_CONCURRENCY` workers and replicas.
  Each worker validates configuration once at start-up.
- Analyses run in a thread pool. Stage objects keep working state during a run, so each
  thread gets its own `Pipeline` (the configuration is shared read-only).
- JSON/CSV analyses take milliseconds; PDFs dominate (pdfplumber). Responses are large
  (hundreds of KB) because they are self-describing; gzip reduces transfer substantially.
- The rule engine is O(rules × parameters referenced); 82 rules is far from any limit.

## 11. Design trade-offs

| Choice | Alternative | Why |
|---|---|---|
| Configured, cited rules | Learned classifier | No labelled dataset; every output must be explainable to the sentence and reproducible; rules can be reviewed by clinicians |
| Noisy-OR pooling | Weighted sum / logistic model | Bounded without clipping, diminishing returns, each term inspectable; weights stay human-meaningful |
| Coverage can only lower a level | Coverage as a confidence multiplier on display | Prevents thin data from reading as strong evidence while never inflating a weak match |
| Explainability built server-side | Client reconstructing links | One source of truth, testable for "no invented edges" |
| Response includes everything | Separate endpoints per section | One request, one consistent snapshot, works offline once loaded, downloadable as the audit record |
| React + TS, no UI/chart library | Template dashboard kit | Graph and trace needed bespoke components; typed contract over a large response; small dependency surface |
| Committed build in `web/` | Node build step in deploy | Deploys on Python-only hosts unchanged; cost is remembering to rebuild (guarded by a test) |
| Hash routing, in-memory analysis | Persisted analyses with URLs | Health data should not be stored or shareable by link by default |
