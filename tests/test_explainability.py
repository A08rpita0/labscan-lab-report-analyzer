"""Explainability tests: the evidence graph and reasoning traces never invent anything.

    python -m pytest tests/test_explainability.py -q

Every edge in the graph must correspond to a record an earlier pipeline stage produced,
every trace number must agree with the score it explains, and an input with nothing
abnormal must explain nothing. Run over every bundled sample and a few invented panels.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from engine.pipeline import Pipeline
from engine.risk import CONTRIBUTION_CEILING, ROLE_FACTOR

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = sorted(p for p in (ROOT / "samples").iterdir()
                 if p.suffix in (".json", ".pdf", ".csv"))
PIPE = Pipeline()


@pytest.fixture(scope="module", params=[p.name for p in SAMPLES])
def result(request):
    path = ROOT / "samples" / request.param
    return PIPE.run(path.read_bytes(), path.name)


def nodes_by_id(r):
    return {n["id"]: n for n in r["explainability"]["graph"]["nodes"]}


def test_every_edge_joins_existing_nodes(result):
    nodes = nodes_by_id(result)
    for e in result["explainability"]["graph"]["edges"]:
        assert e["source"] in nodes and e["target"] in nodes, e["id"]
        assert e["basis"], "every edge names the field it was read from"


def test_parameter_to_pattern_edges_are_real_trigger_hits(result):
    hits = {(h["parameter_id"], c["cohort_id"]): h
            for c in result["cohorts"] for h in c["hits"] if h["effective_weight"] > 0}
    for e in result["explainability"]["graph"]["edges"]:
        if e["source"].startswith("p:") and e["target"].startswith("c:"):
            key = (e["source"][2:], e["target"][2:])
            assert key in hits, "graph invented %s -> %s" % key
            assert e["effective_weight"] == hits[key]["effective_weight"]
            assert e["kind"] == hits[key]["role"]
    # and the converse: every hit that carried weight is drawn
    drawn = {(e["source"][2:], e["target"][2:]) for e in result["explainability"]["graph"]["edges"]}
    assert set(hits) <= drawn


def test_pattern_to_condition_edges_are_the_risk_contributions(result):
    contrib = {(c["cohort_id"], r["disease_id"]): c
               for r in result["disease_risks"] for c in r["contributions"]}
    seen = set()
    for e in result["explainability"]["graph"]["edges"]:
        if e["source"].startswith("c:") and e["target"].startswith("d:"):
            key = (e["source"][2:], e["target"][2:])
            assert key in contrib, "graph invented %s -> %s" % key
            c = contrib[key]
            assert e["contribution"] == c["contribution"] and e["dm_basis"] == c["dm_basis"]
            assert e["role_factor"] == ROLE_FACTOR[c["role"]]
            seen.add(key)
    assert seen == set(contrib)


def test_direct_criterion_edges_match_direct_evidence(result):
    direct = {(r["direct_evidence"]["parameter_id"], r["disease_id"])
              for r in result["disease_risks"] if r.get("direct_evidence")}
    drawn = {(e["source"][2:], e["target"][2:]) for e in result["explainability"]["graph"]["edges"]
             if e["kind"] == "direct_criterion"}
    assert drawn == direct


def test_action_nodes_are_real_plan_steps_with_recorded_links(result):
    recs = {r["id"]: r for r in result["recommendations"]}
    names = {n["id"]: n for n in result["explainability"]["graph"]["nodes"]}
    for n in names.values():
        if n["type"] == "action":
            assert n["ref"] in recs and n["text"] == recs[n["ref"]]["text"]
    for e in result["explainability"]["graph"]["edges"]:
        if not e["target"].startswith("a:"):
            continue
        rec = recs[e["target"][2:]]
        src = names[e["source"]]
        if e["kind"] == "cites":
            assert src["ref"] in {v["parameter_id"] for v in rec["values"]}
        elif e["kind"] == "addresses":
            assert rec["finding"] in (src.get("dm_name"), src["label"])
        elif e["kind"] == "cohort_action":
            assert rec["trace"] == "cohort_action" and rec["trace_detail"] == src["ref"]
        elif e["kind"] == "parameter_action":
            assert rec["trace"] == "parameter_action" and rec["trace_detail"] == src["ref"]
        elif e["kind"] == "source":
            assert src.get("dm_name", src["label"]) in rec["sources"] or src["label"] in rec["sources"]
        elif e["kind"] == "would_test":
            assert rec["trace"] == "coverage_gap"
        else:
            pytest.fail("unexpected action edge kind %s" % e["kind"])


def test_recommendation_ids_are_unique_and_ordered(result):
    ids = [r["id"] for r in result["recommendations"]]
    assert ids == ["a%d" % i for i in range(len(ids))]


def test_trace_aggregation_recomputes_the_engine_score(result):
    by_id = {r["disease_id"]: r for r in result["disease_risks"]}
    assert len(result["explainability"]["traces"]) == len(result["disease_risks"])
    for t in result["explainability"]["traces"]:
        r = by_id[t["disease_id"]]
        agg = next(s for s in t["steps"] if s["stage"] == "aggregation")["data"]
        product = 1.0
        for c in r["contributions"]:
            product *= 1.0 - min(CONTRIBUTION_CEILING, c["contribution"])
        assert agg["score"] == r["score"]
        assert abs(agg["recomputed_score"] - r["score"]) < 1e-3
        assert abs((1 - product) - r["score"]) < 1e-3
        assert agg["final_level"] == r["evidence_level"]


def test_trace_steps_cover_the_whole_pipeline(result):
    for t in result["explainability"]["traces"]:
        stages = [s["stage"] for s in t["steps"]]
        assert stages == ["input", "normalization", "abnormality", "pattern", "mapping",
                          "aggregation", "recommendation"]
        assert all(s["summary"] for s in t["steps"])
        r = next(x for x in result["disease_risks"] if x["disease_id"] == t["disease_id"])
        mapping = next(s for s in t["steps"] if s["stage"] == "mapping")["items"]
        assert [m["contribution"] for m in mapping] == [c["contribution"] for c in r["contributions"]]


def test_trace_inputs_are_the_values_actually_read(result):
    params = {p["parameter_id"]: p for p in result["parameters"]}
    for t in result["explainability"]["traces"]:
        for item in t["steps"][0]["items"]:
            p = params[item["parameter_id"]]
            if p["raw"]:
                assert item["raw_value"] == p["raw"]["raw_value"]
                assert item["source_path"] == p["raw"]["source_path"]
            else:
                assert item["derived"] and p["derived"]


def test_cohort_evaluation_accounts_for_every_rule(result):
    ev = result["explainability"]["cohort_evaluation"]
    assert ev["configured"] == 82 == len(ev["rules"]) == sum(ev["totals"].values())
    fired = {r["id"] for r in ev["rules"] if r["status"] == "fired"}
    assert fired == {c["cohort_id"] for c in result["cohorts"]}
    assert ev["totals"].get("not_assessable", 0) == len(result["cohorts_not_assessable"])


def test_condition_candidates_partition(result):
    cands = result["explainability"]["condition_candidates"]
    reported = {r["name"] for r in cands["rows"] if r["status"] == "reported"}
    assert reported == {r["name"] for r in result["disease_risks"]}
    assert cands["linked_from_fired_patterns"] == len(cands["rows"])


def test_parameter_links_only_reference_graph_relationships(result):
    links = result["explainability"]["parameter_links"]
    nodes = nodes_by_id(result)
    for pid, entry in links.items():
        for c in entry["cohorts"]:
            assert "c:" + c["id"] in nodes
        for a in entry["actions"]:
            assert "a:" + a in nodes


def test_explainability_is_deterministic():
    data = (ROOT / "samples" / "p7_report.pdf").read_bytes()
    a = PIPE.run(data, "p7_report.pdf")["explainability"]
    b = PIPE.run(data, "p7_report.pdf")["explainability"]
    assert json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def test_run_metadata_is_measured_and_separate():
    r = PIPE.run((ROOT / "samples" / "p1_metabolic.json").read_bytes(), "p1.json")
    stages = r["run"]["stages"]
    assert all(s["ms"] >= 0 for s in stages)
    assert r["run"]["total_ms"] >= sum(s["ms"] for s in stages) - 1.0
    assert "run" not in r["summary"] and "timings" not in json.dumps(r["explainability"])


# ------------------------------------------------------------------ edge inputs

def test_unrecognised_only_report_explains_nothing():
    payload = {"tests": [{"test_name": "Zorblax Index", "value": 4.2, "unit": "zu",
                          "reference_range": "1 - 3"}]}
    r = PIPE.run(json.dumps(payload).encode(), "x.json")
    assert r["analysed"] is False and "explainability" not in r
    assert r["run"]["stages"][-1]["stage"] == "document_check"


def test_abnormal_value_with_no_rule_is_counted_not_drawn():
    # A result outside its printed range that no pattern interprets: it is a lab finding,
    # never a node with invented relationships.
    payload = {"patient": {"sex": "female", "age": 40},
               "tests": [{"test_name": "Haemoglobin", "value": 13.1, "unit": "g/dL"},
                         {"test_name": "Serum Chloride", "value": 109, "unit": "mmol/L",
                          "reference_range": "98 - 107"}]}
    r = PIPE.run(json.dumps(payload).encode(), "x.json")
    assert r["analysed"]
    g = r["explainability"]["graph"]
    linked_params = {e["source"] for e in g["edges"] if e["source"].startswith("p:")}
    for n in g["nodes"]:
        if n["type"] == "parameter":
            assert n["id"] in linked_params, "no orphan parameter nodes"
    assert g["stats"]["abnormal_parameters_not_in_graph"] == sum(
        1 for p in r["parameters"] if p["abnormal"] and "p:" + p["parameter_id"] not in
        {n["id"] for n in g["nodes"]})


def test_vetoed_condition_never_appears_in_graph():
    r = PIPE.run((ROOT / "samples" / "p3_febrile.json").read_bytes(), "p3.json")
    vetoed = {s["disease"] for s in r["suppressed_findings"] if "disease" in s}
    assert vetoed, "the febrile sample carries a hard exclusion"
    labels = {n.get("dm_name") for n in r["explainability"]["graph"]["nodes"]}
    assert not (vetoed & labels)
