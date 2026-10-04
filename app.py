"""HTTP service for LabScan, an explainable lab report analyzer.

Upload a laboratory report (PDF, CSV, TSV, TXT or JSON) and receive the full,
explainable analysis: normalised results, detected patterns, Disease Master signals,
the evidence graph, a reasoning trace per finding, and a traceable action plan.

    python -m uvicorn app:app --port 8000      then open http://127.0.0.1:8000

Design decisions that matter for a service handling health data:
  - Uploads are held in memory only. Starlette spools multipart files over 1 MB to a
    temporary file on disk; the spool threshold is raised above the upload limit so a
    report is never written to disk, and the body size is enforced before parsing.
  - Errors use one envelope - {detail, error: {code, message, hint}, request_id} - and
    never carry exception text, tracebacks or filesystem paths.
  - Logs record method, route, status, size and timing. Never filenames, patient
    fields or results: a filename can itself carry a patient's name.
  - The analysis is CPU-bound, so it runs in a worker thread with a time limit rather
    than on the event loop, where one large PDF would stall every other request.
"""
from __future__ import annotations

import json
import logging
import mimetypes
import os
import re
import time
import tomllib
import uuid
from collections import Counter
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import anyio
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartParser

from engine.config import get_config
from engine.explain import scoring_model
from engine.pipeline import ENGINE_VERSION, get_pipeline

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"                    # the built frontend (frontend/ -> npm run build)
SAMPLES = ROOT / "samples"

# Vercel Functions refuse request bodies over 4.5 MB before they reach the app, so the
# default there is 4 MB: the interface then states the real limit and checks it up front.
_DEFAULT_UPLOAD_MB = "4" if os.environ.get("VERCEL") else "20"
MAX_BYTES = int(float(os.environ.get("DRE_MAX_UPLOAD_MB", _DEFAULT_UPLOAD_MB)) * 1024 * 1024)
ANALYSIS_TIMEOUT_S = float(os.environ.get("DRE_ANALYSIS_TIMEOUT_S", "60"))
ALLOWED_SUFFIXES = {".json", ".pdf", ".csv", ".tsv", ".txt"}
SAMPLE_MEDIA_TYPES = {".json": "application/json", ".pdf": "application/pdf",
                      ".csv": "text/csv", ".tsv": "text/tab-separated-values",
                      ".txt": "text/plain"}

# Keep every accepted upload in memory (see module docstring).
MultiPartParser.spool_max_size = MAX_BYTES + 1024 * 1024

# StaticFiles takes content types from the `mimetypes` module, which on Windows reads the
# registry - where .js is commonly mapped to text/plain. With X-Content-Type-Options:
# nosniff the browser then refuses the bundle and the page stays blank. Pinned here so
# the frontend loads identically on every host.
for _ext, _type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
                    (".svg", "image/svg+xml"), (".woff2", "font/woff2"), (".woff", "font/woff"),
                    (".json", "application/json")):
    mimetypes.add_type(_type, _ext)

log = logging.getLogger("dre")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    log.addHandler(_h)
    log.setLevel(os.environ.get("DRE_LOG_LEVEL", "INFO"))
    log.propagate = False

@asynccontextmanager
async def _lifespan(_app):
    """Warm each worker before it takes traffic.

    Configuration is loaded and validated here, so a broken config is logged at boot
    rather than on the first request. pdfplumber is imported lazily by the extractor;
    importing it now moves that cost - including bytecode compilation in a container
    run with PYTHONDONTWRITEBYTECODE - off the first PDF a user uploads.
    """
    t0 = time.perf_counter()
    cfg = get_config()
    get_pipeline()
    try:
        import pdfplumber  # noqa: F401
    except ImportError:
        pass
    log.info("startup config_ok=%s config=%s warmup_ms=%.0f", cfg.validation["ok"],
             cfg.fingerprint["sha256"], (time.perf_counter() - t0) * 1000)
    yield


app = FastAPI(
    lifespan=_lifespan,
    title="LabScan",
    version=ENGINE_VERSION,
    description=("Understand your lab report. Spot what needs attention. "
                 "Explainable laboratory signal analysis. Deterministic, configuration-driven "
                 "and auditable: every signal traces back to the laboratory values, pattern "
                 "rules and Disease Master fields behind it. A risk-signalling tool, not a "
                 "diagnostic system."),
)


# ============================================================ errors

class ApiError(Exception):
    def __init__(self, status, code, message, hint=None, **extra):
        super().__init__(message)
        self.status, self.code, self.message, self.hint, self.extra = (
            status, code, message, hint, extra)


class ErrorBody(BaseModel):
    code: str
    message: str
    hint: Optional[str] = None


class ErrorEnvelope(BaseModel):
    detail: str
    error: ErrorBody
    request_id: Optional[str] = None


def _envelope(request, status, code, message, hint=None, **extra):
    body = {"detail": message, "error": {"code": code, "message": message, "hint": hint},
            "request_id": getattr(request.state, "request_id", None)}
    body.update(extra)
    return JSONResponse(status_code=status, content=body)


@app.exception_handler(ApiError)
async def _api_error(request: Request, exc: ApiError):
    return _envelope(request, exc.status, exc.code, exc.message, exc.hint, **exc.extra)


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError):
    fields = sorted({".".join(str(p) for p in e.get("loc", [])[1:]) or "body"
                     for e in exc.errors()})
    return _envelope(request, 422, "invalid_request",
                     "The request was not in the expected shape (%s)." % ", ".join(fields),
                     "Send multipart/form-data with a 'file' field; 'sex' and 'age' are optional.")


@app.exception_handler(StarletteHTTPException)
async def _http_error(request: Request, exc: StarletteHTTPException):
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return _envelope(request, exc.status_code, "http_%d" % exc.status_code, message)


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    # The traceback goes to the server log only; the client gets an id to quote.
    log.exception("unhandled error request_id=%s route=%s",
                  getattr(request.state, "request_id", None), request.url.path)
    return _envelope(request, 500, "internal_error",
                     "The analysis service hit an unexpected error.",
                     "Try again. If it keeps happening, report the request id.")


# ============================================================ middleware

_CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; "
        "form-action 'self'; frame-ancestors 'none'")
_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


class UploadLimit:
    """Reject an oversized analysis upload before it is parsed.

    Content-Length is checked up front; a body sent without one (chunked) is counted as
    it streams, so the limit holds either way and nothing over it is buffered.
    """

    def __init__(self, app_, limit):
        self.app, self.limit = app_, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" \
                or not scope["path"].startswith("/api/analyse"):
            return await self.app(scope, receive, send)
        ceiling = self.limit + 64 * 1024          # multipart framing and form fields
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > ceiling:
            return await _too_large(send)

        seen = 0
        started = False

        async def counting_receive():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > ceiling:
                    raise _BodyTooLarge()
            return message

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _BodyTooLarge:
            if not started:
                await _too_large(send)


class _BodyTooLarge(Exception):
    pass


async def _too_large(send):
    mb = MAX_BYTES // (1024 * 1024)
    body = json.dumps({
        "detail": "The file is larger than %d MB." % mb,
        "error": {"code": "file_too_large", "message": "The file is larger than %d MB." % mb,
                  "hint": "Upload the report as a text PDF, CSV or JSON under %d MB." % mb},
        "request_id": None}).encode()
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


@app.middleware("http")
async def _request_context(request: Request, call_next):
    """Request id, security headers, and one privacy-safe log line per request."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", rid):
        rid = uuid.uuid4().hex[:12]
    request.state.request_id = rid
    t0 = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - t0) * 1000

    h = response.headers
    h["X-Request-ID"] = rid
    h["X-Content-Type-Options"] = "nosniff"
    h["Referrer-Policy"] = "no-referrer"
    h["X-Frame-Options"] = "DENY"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if not request.url.path.startswith(_DOCS_PATHS):
        h["Content-Security-Policy"] = _CSP
    if request.url.path.startswith("/api/analyse"):
        # An analysis is personal health data: never cached by a browser or proxy.
        h["Cache-Control"] = "no-store"
    log.info("request id=%s method=%s path=%s status=%d bytes_in=%s ms=%.1f",
             rid, request.method, request.url.path, response.status_code,
             request.headers.get("content-length", "-"), ms)
    return response


app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(UploadLimit, limit=MAX_BYTES)


# ============================================================ helpers

def _safe_name(name):
    """A filename fit to echo back: no directories, no control characters, bounded."""
    name = re.split(r"[\\/]", str(name or ""))[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return name[:160] or "upload"


def _clean_sex(value):
    if value is None or str(value).strip() == "":
        return None
    v = str(value).strip().lower()
    v = {"m": "male", "f": "female"}.get(v, v)
    if v not in ("male", "female"):
        raise ApiError(422, "invalid_sex", "Sex must be 'male' or 'female' when given.",
                       "Leave it empty to read it from the report.")
    return v


def _clean_age(value):
    if value is None or str(value).strip() == "":
        return None
    try:
        age = float(value)
    except (TypeError, ValueError):
        raise ApiError(422, "invalid_age", "Age must be a number of years.") from None
    if not 0 <= age <= 130:
        raise ApiError(422, "invalid_age", "Age must be between 0 and 130 years.")
    return age


def _check_content(data, suffix):
    """Cheap structural checks that turn a confusing downstream failure into a clear,
    specific message. Nothing here judges whether the content is a lab report - the
    pipeline's document check does that."""
    if not data or not data.strip():
        raise ApiError(400, "empty_file", "The uploaded file is empty.",
                       "Check that the export completed, then upload it again.")
    if suffix == ".pdf" and not data.lstrip()[:5] == b"%PDF-":
        raise ApiError(422, "corrupt_pdf", "This file has a .pdf extension but is not a valid PDF.",
                       "Re-export or re-download the report as a PDF and try again.")
    if suffix == ".json":
        try:
            json.loads(data.decode("utf-8-sig"))
        except UnicodeDecodeError:
            raise ApiError(422, "invalid_json", "This JSON file is not UTF-8 text.",
                           "Save the file with UTF-8 encoding and try again.") from None
        except json.JSONDecodeError as e:
            raise ApiError(422, "invalid_json",
                           "This file is not valid JSON (line %d, column %d: %s)."
                           % (e.lineno, e.colno, e.msg),
                           "Validate the JSON or export it again from the source system.") from None


async def _run(data, filename, sex, age, patient_id=None):
    def work():
        return get_pipeline().run(data, filename, sex=sex, age=age, patient_id=patient_id)
    try:
        with anyio.fail_after(ANALYSIS_TIMEOUT_S):
            return await anyio.to_thread.run_sync(work, abandon_on_cancel=True)
    except TimeoutError:
        raise ApiError(504, "analysis_timeout",
                       "The analysis did not finish within %g seconds." % ANALYSIS_TIMEOUT_S,
                       "Very long or image-heavy PDFs are slow to read; try a CSV or JSON "
                       "export of the same results.") from None
    except ApiError:
        raise
    except Exception:
        log.exception("analysis failed format=%s bytes=%d", Path(filename).suffix, len(data))
        raise ApiError(422, "analysis_failed",
                       "This file could not be analysed.",
                       "Check that it is a laboratory report in PDF, CSV, TSV, TXT or JSON "
                       "form. Nothing from it has been kept.") from None


def _respond(result, request):
    log.info("analysis id=%s analysed=%s params=%s signals=%s total_ms=%s",
             request.state.request_id, result.get("analysed"),
             (result.get("summary") or {}).get("parameters_recognised"),
             (result.get("summary") or {}).get("conditions_flagged"),
             (result.get("run") or {}).get("total_ms"))
    # A document that is not a laboratory report is refused rather than analysed into an
    # empty dashboard. 422: the upload was well formed, but it is not something this
    # service can act on. The verdict object says what was found and what to do.
    if not result.get("analysed", True):
        doc = result["document"]
        return _envelope(request, 422,
                         "unreadable" if doc.get("status") == "unreadable" else "not_a_report",
                         doc["title"], doc.get("guidance"),
                         document=doc, source_file=result["source_file"],
                         summary=result.get("summary"), warnings=result.get("warnings"),
                         run=result.get("run"))
    return JSONResponse(result)


# ============================================================ samples

def _load_manifest():
    path = SAMPLES / "manifest.toml"
    try:
        entries = tomllib.loads(path.read_text(encoding="utf-8")).get("sample", [])
    except (OSError, tomllib.TOMLDecodeError):
        entries = []
    out = {}
    for e in entries:
        f = SAMPLES / str(e.get("file", ""))
        # Only plain files directly inside samples/, with an accepted extension.
        if f.parent == SAMPLES and f.is_file() and f.suffix.lower() in ALLOWED_SUFFIXES:
            out[f.name] = e
    return out


def _sample_label(path):
    if path.suffix.lower() != ".json":
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("_label")
    except (OSError, ValueError, AttributeError):
        return None


def _sample_path(name):
    """Resolve a sample by name against the manifest allowlist - never by path."""
    manifest = _load_manifest()
    if name not in manifest:
        raise ApiError(404, "sample_not_found", "No sample named '%s'." % _safe_name(name)[:80])
    return SAMPLES / name


class SampleInfo(BaseModel):
    file: str
    title: str
    description: str
    scenario: Optional[str] = None
    format: str
    size_bytes: int
    exercises: list[str]


# ============================================================ routes

@app.get("/api/health", tags=["service"])
def health():
    cfg = get_config()
    return {
        "status": "ok" if cfg.validation["ok"] else "config_error",
        "version": ENGINE_VERSION,
        "config": cfg.validation["counts"],
        "config_fingerprint": cfg.fingerprint,
        "errors": cfg.validation["errors"],
        "warnings": cfg.validation["warnings"][:20],
        "warning_count": len(cfg.validation["warnings"]),
        "limits": {"max_upload_mb": MAX_BYTES // (1024 * 1024),
                   "analysis_timeout_s": ANALYSIS_TIMEOUT_S,
                   "accepted_formats": sorted(s.lstrip(".") for s in ALLOWED_SUFFIXES)},
    }


@app.get("/api/samples", response_model=list[SampleInfo], tags=["samples"])
def list_samples():
    out = []
    for name, e in _load_manifest().items():
        path = SAMPLES / name
        out.append(SampleInfo(
            file=name, title=e.get("title") or path.stem,
            description=e.get("description") or "",
            scenario=_sample_label(path),
            format=path.suffix.lstrip(".").upper(),
            size_bytes=path.stat().st_size,
            exercises=list(e.get("exercises") or [])))
    return out


@app.get("/api/samples/{name}", tags=["samples"])
def get_sample(name: str):
    """The raw input file, so the page can show exactly what went into an analysis."""
    path = _sample_path(name)
    return FileResponse(path, media_type=SAMPLE_MEDIA_TYPES[path.suffix.lower()],
                        filename=path.name)


@app.get("/api/config/summary", tags=["configuration"])
def config_summary():
    """What the engine is running on: the Disease Master, the pattern rules, the parameter
    dictionary and the scoring model - for the System Reference page."""
    cfg = get_config()
    dm_review = Counter(d.get("review_status") or "not stated" for d in cfg.diseases)
    dm_urgency = Counter((d.get("urgency") or {}).get("tier", "unknown") for d in cfg.diseases)
    dm_class = Counter(d.get("classification") or "not stated" for d in cfg.diseases)
    return {
        "engine": {"version": ENGINE_VERSION, "config": cfg.fingerprint},
        "disease_master": {
            "source_file": cfg.dm_meta.get("source_file"),
            "sheet": cfg.dm_meta.get("source_sheet"),
            "columns": cfg.dm_meta.get("columns"),
            "disease_count": len(cfg.diseases),
            "skipped_rows": cfg.dm_meta.get("skipped_rows"),
            "provenance_note": cfg.dm_meta.get("provenance_note"),
            "review_status": dict(dm_review),
            "urgency_tiers": dict(dm_urgency),
            "classification": dict(dm_class),
        },
        "counts": cfg.validation["counts"],
        "validation": {"ok": cfg.validation["ok"], "errors": len(cfg.validation["errors"]),
                       "warnings": len(cfg.validation["warnings"])},
        "scoring_model": scoring_model(),
        "analysis_modes": {
            "weighted": "fires when at least min_triggers distinct trigger conditions are met",
            "count_of": "fires when at least count_required named components are met - used "
                        "where the clinical definition is itself a count",
        },
        "exclusion_rules": [
            {"id": r["id"], "parameter": r["parameter"], "reason": r.get("reason"),
             "vetoes_diseases": r.get("vetoes_diseases", []),
             "enabled": r.get("enabled", True)}
            for r in cfg.exclusions.get("rules", [])],
        "profiles": cfg.dm_profiles,
        "field_legend": cfg.dm_legend,
        "data_quality_notes": cfg.dm_notes,
        "unclear_mappings_resolved": cfg.dm_unclear,
        "unmappable": cfg.unmappable,
        "cohorts": [
            {
                "id": c["id"], "name": c["name"],
                "category": c.get("category"), "domain": c.get("domain"),
                "description": c.get("description"),
                "profiles_touched": c.get("profiles_touched", []),
                "cross_profile": bool(c.get("cross_profile_rationale")),
                "cross_profile_rationale": c.get("cross_profile_rationale"),
                "mode": c.get("mode", "weighted"),
                "evidence": c.get("evidence", []),
                "diseases": c.get("diseases", []),
                "expected_parameters": c.get("expected_parameters", []),
                "source_file": c.get("_source_file"),
            }
            for c in cfg.cohorts
        ],
        "parameters": [
            {"id": p["id"], "name": p["name"], "profile": p.get("profile"),
             "type": p["type"], "unit": p.get("unit"),
             "alias_count": len(p.get("aliases", [])),
             "derived": bool(p.get("derived_from"))}
            for p in cfg.parameters
        ],
    }


@app.get("/api/diseases", tags=["configuration"])
def diseases():
    cfg = get_config()
    return [
        {"id": d["id"], "name": d["name"], "classification": d.get("classification"),
         "profiles": d.get("profiles"), "urgency": d.get("urgency"),
         "icd10": d.get("icd10"), "review_status": d.get("review_status"),
         "markers": d["fields"].get("Related Markers/Tests"),
         "high_risk_indicators": d["fields"].get("High-Risk Indicators"),
         "mapped_by": [c["id"] for c, _ in cfg.links_by_disease.get(d["name"], [])]}
        for d in cfg.diseases
    ]


@app.get("/api/diseases/{disease_id}", tags=["configuration"])
def disease(disease_id: str):
    """One Disease Master row, verbatim, with every pattern rule that maps onto it."""
    cfg = get_config()
    d = next((x for x in cfg.diseases if x["id"] == disease_id), None)
    if d is None:
        raise ApiError(404, "disease_not_found", "No Disease Master row with that id.")
    unmappable = next((u for u in cfg.unmappable.get("conditions", [])
                       if u["name"] == d["name"]), None)
    return {
        "id": d["id"], "name": d["name"], "classification": d.get("classification"),
        "profiles": d.get("profiles"), "urgency": d.get("urgency"), "icd10": d.get("icd10"),
        "review_status": d.get("review_status"), "fields": d["fields"],
        "linked_cohorts": [
            {"cohort_id": c["id"], "cohort_name": c["name"], "role": link.get("role"),
             "weight": link.get("weight"), "dm_basis": link.get("dm_basis"),
             "requires_any": link.get("requires_any", []),
             "evidence": c.get("evidence", [])}
            for c, link in cfg.links_by_disease.get(d["name"], [])],
        "not_lab_mappable": unmappable,
    }


ANALYSIS_RESPONSES = {
    400: {"model": ErrorEnvelope, "description": "Empty file"},
    404: {"model": ErrorEnvelope, "description": "Unknown sample"},
    413: {"model": ErrorEnvelope, "description": "File over the size limit"},
    415: {"model": ErrorEnvelope, "description": "Unsupported file type"},
    422: {"model": ErrorEnvelope,
          "description": "Invalid input, corrupt file, or not a laboratory report"},
    504: {"model": ErrorEnvelope, "description": "Analysis exceeded the time limit"},
}


@app.post("/api/analyse", tags=["analysis"], responses=ANALYSIS_RESPONSES)
async def analyse_upload(request: Request,
                         file: UploadFile = File(...),
                         sex: Optional[str] = Form(None),
                         age: Optional[str] = Form(None),
                         patient_id: Optional[str] = Form(None)):
    """Analyse an uploaded report. Held in memory for the length of the request only."""
    filename = _safe_name(file.filename)
    suffix = Path(filename).suffix.lower()
    if suffix and suffix not in ALLOWED_SUFFIXES:
        raise ApiError(415, "unsupported_type",
                       "Files of type '%s' are not supported." % suffix[:12],
                       "Upload a PDF (with selectable text), CSV, TSV, TXT or JSON report.")
    sex_v, age_v = _clean_sex(sex), _clean_age(age)
    pid = re.sub(r"[\x00-\x1f\x7f]", "", patient_id)[:80] if patient_id else None
    data = await file.read()
    await file.close()
    if len(data) > MAX_BYTES:
        raise ApiError(413, "file_too_large",
                       "The file is larger than %d MB." % (MAX_BYTES // (1024 * 1024)))
    _check_content(data, suffix)
    result = await _run(data, filename, sex_v, age_v, pid)
    return _respond(result, request)


@app.post("/api/analyse/sample", tags=["analysis"], responses=ANALYSIS_RESPONSES)
async def analyse_sample(request: Request,
                         file: str = Form(...),
                         sex: Optional[str] = Form(None),
                         age: Optional[str] = Form(None)):
    """Analyse one of the bundled synthetic samples, by name."""
    path = _sample_path(file)
    result = await _run(path.read_bytes(), path.name, _clean_sex(sex), _clean_age(age))
    return _respond(result, request)


# ============================================================ frontend

@app.get("/", include_in_schema=False)
def index():
    page = WEB / "index.html"
    if not page.is_file():
        return Response(
            "The frontend has not been built. Run: cd frontend && npm ci && npm run build\n"
            "The API is available under /api (see /docs).",
            status_code=503, media_type="text/plain")
    return FileResponse(page, headers={"Cache-Control": "no-cache"})


if WEB.is_dir():
    # Mounted last, so every /api route above takes precedence. Hashed asset names make
    # long-lived caching safe; index.html itself is served no-cache above.
    app.mount("/", StaticFiles(directory=WEB), name="web")
