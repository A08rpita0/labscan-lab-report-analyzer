"""HTTP API tests: contract, every error path, the bundled samples, and security.

    python -m pytest tests/test_api.py -q

Runs the real FastAPI app in-process (TestClient) against the real engine and the real
sample files. Every input here is synthetic.
"""
from __future__ import annotations

import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as service
from engine.pipeline import Pipeline

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
MANIFEST = tomllib.loads((SAMPLES / "manifest.toml").read_text(encoding="utf-8"))["sample"]


@pytest.fixture(scope="module")
def client():
    return TestClient(service.app, raise_server_exceptions=False)


@pytest.fixture(scope="module")
def sample_results(client):
    out = {}
    for e in MANIFEST:
        r = client.post("/api/analyse/sample", data={"file": e["file"]})
        assert r.status_code == 200, (e["file"], r.text[:300])
        out[e["file"]] = r.json()
    return out


def upload(client, name, data, ctype="application/octet-stream", **form):
    return client.post("/api/analyse", files={"file": (name, data, ctype)}, data=form)


def assert_error(r, status, code):
    assert r.status_code == status, r.text[:400]
    body = r.json()
    assert body["error"]["code"] == code, body
    assert body["detail"] == body["error"]["message"]
    assert body["request_id"] == r.headers.get("x-request-id") or status == 413
    return body


# ------------------------------------------------------------------ service

def test_health_reports_config_and_fingerprint(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    h = r.json()
    assert h["status"] == "ok" and h["errors"] == []
    assert h["config"]["diseases"] == 129 and h["config"]["cohorts"] == 82
    assert len(h["config_fingerprint"]["sha256"]) == 16
    assert h["limits"]["accepted_formats"] == ["csv", "json", "pdf", "tsv", "txt"]


def test_security_headers_on_every_response(client):
    for path in ("/api/health", "/api/samples", "/"):
        r = client.get(path)
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert "default-src 'self'" in r.headers["content-security-policy"]
        assert "'unsafe-inline'" not in r.headers["content-security-policy"]
        assert r.headers["x-request-id"]


def test_analysis_responses_are_never_cached(client):
    r = client.post("/api/analyse/sample", data={"file": "p5_healthy.json"})
    assert r.headers["cache-control"] == "no-store"


def test_large_responses_are_compressed(client):
    r = client.post("/api/analyse/sample", data={"file": "p1_metabolic.json"},
                    headers={"accept-encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"


def test_request_id_is_echoed_only_when_safe(client):
    assert client.get("/api/health", headers={"x-request-id": "abc-123"}).headers[
        "x-request-id"] == "abc-123"
    hostile = client.get("/api/health", headers={"x-request-id": "<script>"})
    assert hostile.headers["x-request-id"] != "<script>"


# ------------------------------------------------------------------ samples

def test_samples_listed_from_manifest_with_metadata(client):
    r = client.get("/api/samples")
    assert r.status_code == 200
    listed = r.json()
    assert [s["file"] for s in listed] == [e["file"] for e in MANIFEST]
    for s in listed:
        assert s["title"] and s["description"] and s["format"] in ("JSON", "PDF", "CSV")
        assert s["size_bytes"] == (SAMPLES / s["file"]).stat().st_size
    # the manifest itself is never offered as a sample
    assert all(not s["file"].endswith(".toml") for s in listed)


def test_raw_sample_input_is_downloadable(client):
    r = client.get("/api/samples/p8_thyroid.csv")
    assert r.status_code == 200 and r.content == (SAMPLES / "p8_thyroid.csv").read_bytes()


@pytest.mark.parametrize("name", ["../app.py", "..\\app.py", "manifest.toml",
                                  "/etc/passwd", "p1_metabolic.json/..", "nonexistent.json"])
def test_sample_lookup_cannot_escape_the_allowlist(client, name):
    assert_error(client.post("/api/analyse/sample", data={"file": name}), 404,
                 "sample_not_found")


def test_every_sample_analyses(sample_results):
    for name, r in sample_results.items():
        assert r["analysed"] is True, name
        assert r["summary"]["parameters_recognised"] > 0, name
        assert r["engine"]["config"]["sha256"], name
        assert r["run"]["total_ms"] > 0, name
        stages = [s["stage"] for s in r["run"]["stages"]]
        assert stages[0] == "extraction" and "explainability" in stages, name


# Each manifest tag is a claim about the sample. These assertions keep every claim true.
TAG_CHECKS = {
    "nested_json": lambda r: any("panels" in (p["raw"] or {}).get("source_path", "")
                                 for p in r["parameters"] if p["raw"]),
    "flat_json": lambda r: any((p["raw"] or {}).get("source_path", "").startswith("$.results.")
                               for p in r["parameters"] if p["raw"]),
    "cross_profile_patterns": lambda r: any(len(c["profiles_touched"]) > 1 for c in r["cohorts"]),
    "derived_values": lambda r: r["summary"]["derived_values"] > 0,
    "unit_conversion": lambda r: any(p["conversion_note"] for p in r["parameters"]),
    "qualitative_results": lambda r: any(p["kind"] == "qualitative" for p in r["parameters"]),
    "exclusion_gates": lambda r: r["summary"]["suppressed_by_exclusion"] > 0,
    "link_gating": lambda r: r["explainability"]["condition_candidates"]["totals"].get("gated", 0) > 0,
    "sparse_input": lambda r: r["summary"]["observations_found"] <= 10,
    "missing_demographics": lambda r: r["patient"]["sex"] is None and r["patient"]["age"] is None,
    "negative_control": lambda r: r["summary"]["abnormal_count"] == 0
    and r["disease_risks"] == [] and r["urgent_findings"] == [],
    "deep_nesting": lambda r: any((p["raw"] or {}).get("source_path", "").count(".") >= 5
                                  for p in r["parameters"] if p["raw"]),
    "duplicate_resolution": lambda r: r["summary"]["duplicates_resolved"] > 0,
    # Calcium is null and albumin is "" in the input: dropped, never imputed.
    "null_values": lambda r: not any(p["parameter_id"] in ("calcium", "albumin")
                                     for p in r["parameters"]),
    "pdf_extraction": lambda r: all(p["raw"]["source_kind"] == "pdf"
                                    for p in r["parameters"] if p["raw"]),
    "multi_profile": lambda r: len(r["summary"]["profiles_touched"]) >= 5,
    "csv_extraction": lambda r: all(p["raw"]["source_kind"] == "csv"
                                    for p in r["parameters"] if p["raw"]),
    "lab_flags": lambda r: any((p["raw"] or {}).get("raw_flag") for p in r["parameters"]),
}


def test_manifest_tags_are_true_of_their_samples(sample_results):
    for e in MANIFEST:
        for tag in e["exercises"]:
            assert tag in TAG_CHECKS, "untested manifest tag %s" % tag
            assert TAG_CHECKS[tag](sample_results[e["file"]]), (e["file"], tag)


def test_negative_control_produces_no_signals_and_no_graph(sample_results):
    r = sample_results["p5_healthy.json"]
    g = r["explainability"]["graph"]
    assert r["summary"]["conditions_flagged"] == 0 and r["cohorts"] == []
    assert g["nodes"] == [] and g["edges"] == []
    assert r["explainability"]["traces"] == []
    assert r["recommendations"], "a healthy panel still gets baseline guidance"


def test_sparse_report_says_how_thin_the_data_is(sample_results):
    r = sample_results["p4_sparse.json"]
    assert r["coverage"]["overall"] in ("very limited", "limited")
    assert r["summary"]["data_coverage_level"] == r["coverage"]["overall"]
    assert any(rec["trace"] == "record_context" for rec in r["recommendations"]), \
        "missing sex must produce a step explaining which ranges depend on it"


def test_caller_supplied_demographics_win(client):
    r = client.post("/api/analyse/sample",
                    data={"file": "p4_sparse.json", "sex": "female", "age": "52"}).json()
    assert r["patient"]["sex"] == "female" and r["patient"]["age"] == 52


# ------------------------------------------------------------------ uploads

@pytest.mark.parametrize("name,ctype", [("p1_metabolic.json", "application/json"),
                                        ("p7_report.pdf", "application/pdf"),
                                        ("p8_thyroid.csv", "text/csv")])
def test_upload_matches_sample_run(client, sample_results, name, ctype):
    r = upload(client, name, (SAMPLES / name).read_bytes(), ctype)
    assert r.status_code == 200
    up, ref = r.json(), sample_results[name]
    assert up["summary"] == ref["summary"]
    assert [d["disease_id"] for d in up["disease_risks"]] == \
           [d["disease_id"] for d in ref["disease_risks"]]


def test_tsv_and_txt_uploads(client):
    lines = (SAMPLES / "p8_thyroid.csv").read_text(encoding="utf-8").splitlines()[5:]
    tsv = "\n".join(l.replace(",", "\t") for l in lines).encode()
    r = upload(client, "panel.tsv", tsv, "text/tab-separated-values")
    assert r.status_code == 200 and r.json()["summary"]["parameters_recognised"] >= 10
    txt = b"Haemoglobin 9.1 g/dL 12.0 - 15.0\nSerum Ferritin 5 ng/mL 15 - 150\nTSH 11.8 uIU/mL 0.4 - 4.0\n"
    r = upload(client, "panel.txt", txt, "text/plain")
    assert r.status_code == 200 and r.json()["summary"]["parameters_recognised"] == 3


def test_byte_order_marked_and_utf16_csv_are_read(client):
    lines = (SAMPLES / "p8_thyroid.csv").read_text(encoding="utf-8").splitlines()[5:]
    body = "\n".join(lines)
    for data in (b"\xef\xbb\xbf" + body.encode(), body.encode("utf-16")):
        r = upload(client, "excel.csv", data, "text/csv")
        assert r.status_code == 200 and r.json()["summary"]["parameters_recognised"] == 12


def test_unsupported_type(client):
    assert_error(upload(client, "scan.png", b"\x89PNG\r\n"), 415, "unsupported_type")


def test_empty_and_whitespace_files(client):
    assert_error(upload(client, "r.json", b""), 400, "empty_file")
    assert_error(upload(client, "r.csv", b"  \n\n "), 400, "empty_file")


def test_corrupt_pdf(client):
    assert_error(upload(client, "r.pdf", b"this is not a pdf"), 422, "corrupt_pdf")


def test_truncated_pdf_is_refused_not_crashed(client):
    data = (SAMPLES / "p7_report.pdf").read_bytes()[:600]
    r = upload(client, "r.pdf", data, "application/pdf")
    assert r.status_code == 422
    assert r.json()["error"]["code"] in ("unreadable", "not_a_report", "analysis_failed")


def test_invalid_json_names_the_position(client):
    body = assert_error(upload(client, "r.json", b'{"tests": [1, 2,'), 422, "invalid_json")
    assert "line 1" in body["detail"]


def test_not_a_report_is_refused_with_guidance(client):
    r = upload(client, "letter.txt", b"Dear team,\nPlease find the October invoice attached.\n",
               "text/plain")
    body = assert_error(r, 422, "not_a_report")
    assert body["document"]["is_report"] is False and body["error"]["hint"]
    assert body["document"]["accepted_formats"]


def test_oversized_upload_is_refused_before_analysis(client):
    big = b"a" * (service.MAX_BYTES + 100_000)
    r = upload(client, "big.txt", big, "text/plain")
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"


def test_invalid_demographics(client):
    assert_error(upload(client, "r.json", b"{}", sex="unknown"), 422, "invalid_sex")
    assert_error(upload(client, "r.json", b"{}", age="old"), 422, "invalid_age")
    assert_error(upload(client, "r.json", b"{}", age="400"), 422, "invalid_age")


def test_missing_file_field(client):
    assert_error(client.post("/api/analyse", data={"sex": "male"}), 422, "invalid_request")


def test_filenames_are_sanitised_in_the_response(client):
    data = (SAMPLES / "p5_healthy.json").read_bytes()
    r = upload(client, "../../etc/report.json", data, "application/json")
    assert r.status_code == 200
    assert r.json()["source_file"] == "report.json"
    # control characters (httpx percent-encodes them on the wire, so tested directly)
    assert service._safe_name("C:\\Users\\x\\\x07rep\x00ort.json") == "report.json"
    assert service._safe_name("") == "upload" and len(service._safe_name("a" * 999)) == 160


def test_internal_errors_do_not_leak_details(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret path C:\\internal\\engine.py line 42")
    monkeypatch.setattr(Pipeline, "run", boom)
    r = upload(client, "r.json", b'{"tests": []}', "application/json")
    assert r.status_code == 422 and r.json()["error"]["code"] == "analysis_failed"
    assert "secret" not in r.text and "engine.py" not in r.text and "Traceback" not in r.text


def test_timeout_is_reported(client, monkeypatch):
    import time as _t
    monkeypatch.setattr(service, "ANALYSIS_TIMEOUT_S", 0.05)
    monkeypatch.setattr(Pipeline, "run", lambda *a, **k: _t.sleep(0.5))
    r = upload(client, "r.json", b'{"tests": []}', "application/json")
    assert_error(r, 504, "analysis_timeout")


# ------------------------------------------------------------------ configuration

def test_config_summary_exposes_the_real_scoring_model(client):
    from engine.risk import EVIDENCE_BANDS, ROLE_FACTOR
    c = client.get("/api/config/summary").json()
    sm = c["scoring_model"]
    assert sm["condition_score"]["role_factor"] == ROLE_FACTOR
    assert [(b["min_score"], b["level"]) for b in sm["evidence_levels"]["bands"]] == EVIDENCE_BANDS
    assert sum(c["disease_master"]["review_status"].values()) == 129
    assert len(c["cohorts"]) == 82 and c["validation"]["ok"] is True


def test_disease_detail_and_unknown_disease(client):
    d = client.get("/api/diseases").json()
    first = client.get("/api/diseases/%s" % d[0]["id"]).json()
    assert first["fields"]["Disease/Medical Condition"] == d[0]["name"]
    assert_error(client.get("/api/diseases/not-a-row"), 404, "disease_not_found")


def test_openapi_schema_is_published(client):
    spec = client.get("/openapi.json").json()
    assert "/api/analyse" in spec["paths"] and spec["info"]["title"] == "LabScan"


def test_concurrent_analyses_do_not_interfere(client, sample_results):
    """Analyses run in a thread pool. Stage objects keep working state during a run, so
    each thread has its own pipeline; interleaved requests must match serial results."""
    from concurrent.futures import ThreadPoolExecutor
    names = ["p6_messy.json", "p1_metabolic.json", "p4_sparse.json", "p8_thyroid.csv"] * 4

    def run(name):
        return name, client.post("/api/analyse/sample", data={"file": name}).json()

    with ThreadPoolExecutor(max_workers=8) as pool:
        for name, r in pool.map(run, names):
            ref = sample_results[name]
            assert r["summary"] == ref["summary"], name
            assert r["rejected_values"] == ref["rejected_values"], name
            assert r["patient"] == ref["patient"], name
