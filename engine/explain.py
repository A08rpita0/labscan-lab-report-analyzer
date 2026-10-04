"""Stage 7 - Explainability: evidence graph, reasoning traces and the evaluation audit.

Nothing here scores, grades or recommends. Every node, edge and trace step is read off
objects the earlier stages already produced:

    parameter  -> pattern     a TriggerHit that carried weight inside a fired cohort
    pattern    -> condition   a RiskContribution the risk engine pooled into a score
    parameter  -> condition   a configured direct criterion the value actually met
    any        -> action      a field the recommendation engine recorded on the step
                              (its resolved finding, its merged sources, the values it
                              quotes, the cohort/parameter rule that produced it)

If an earlier stage did not record a relationship, it does not appear here. Each edge
names the field it was read from in `basis`, so the graph can be audited against the
raw analysis JSON rather than taken on trust.
"""
from __future__ import annotations

from .cohorts import REDUNDANCY_DISCOUNT, SUPPORT_ALLOWANCE, SUPPORTING_FACTOR
from .risk import (CONTRIBUTION_CEILING, COVERAGE_CAP_THRESHOLD, COVERAGE_SOFT_CAP,
                   COVERAGE_SOFT_THRESHOLD, EVIDENCE_BANDS, REPORT_FLOOR, ROLE_FACTOR,
                   URGENT_SCORE_FLOOR)

# When two recorded relationships join the same pair of nodes, the more specific one
# names the edge. A step titled by a condition "addresses" it; the same pair also being
# in the step's merged sources adds nothing new.
_EDGE_PRECEDENCE = ["direct_criterion", "addresses", "cohort_action", "parameter_action",
                    "source", "cites", "would_test"]



def _precedence(kind):
    # Structural kinds (trigger, supporting, component, maps_to) never share a node pair
    # with a plan-step kind; ranked first so a repeat of the same pair keeps the original.
    return _EDGE_PRECEDENCE.index(kind) if kind in _EDGE_PRECEDENCE else -1


def scoring_model():
    """The constants and formulas the engine actually runs with, read from the modules
    that use them - so the documentation shown to a user cannot drift from the code."""
    return {
        "cohort_confidence": {
            "weighted": ("confidence = min(1, fired_weight / (required_trigger_weight + "
                         "min(SUPPORT_ALLOWANCE, measured_support_weight))) x coverage_factor"),
            "count_of": ("confidence = 0.70 + 0.25 x components_beyond_required / "
                         "(components_total - required) + 0.05 x support, then x coverage_factor"),
            "coverage_factor": "0.72 + 0.28 x min(1, coverage / 0.6)",
            "severity_modulation": "effective_weight = weight x (0.6 + 0.4 x severity_score)",
            "constants": {
                "SUPPORTING_FACTOR": SUPPORTING_FACTOR,
                "REDUNDANCY_DISCOUNT": REDUNDANCY_DISCOUNT,
                "SUPPORT_ALLOWANCE": SUPPORT_ALLOWANCE,
            },
            "notes": [
                "Supporting signals are worth SUPPORTING_FACTOR of a defining trigger.",
                "Within one cohort, only the strongest signal of each redundancy group keeps "
                "full weight; the others keep REDUNDANCY_DISCOUNT of it.",
                "Supporting tests that were never ordered do not enlarge the denominator; "
                "their absence is charged once, through the coverage factor.",
            ],
        },
        "condition_score": {
            "contribution": "contribution = link_weight x cohort_confidence x role_factor x support_penalty",
            "combination": "score = 1 - product(1 - min(CONTRIBUTION_CEILING, contribution))",
            "name": "noisy-OR",
            "role_factor": dict(ROLE_FACTOR),
            "contribution_ceiling": CONTRIBUTION_CEILING,
            "reporting_floor": REPORT_FLOOR,
            "notes": [
                "Noisy-OR is bounded in [0, 1] without clipping; independent evidence raises "
                "the score with diminishing returns, and every term stays inspectable.",
                "Only the strongest link from each cohort to a condition is counted.",
                "The score measures how strongly configured evidence is present. It is not "
                "a probability of having the condition.",
            ],
        },
        "evidence_levels": {
            "bands": [{"level": label, "min_score": threshold}
                      for threshold, label in EVIDENCE_BANDS],
            "coverage_caps": [
                {"when": "coverage < %g" % COVERAGE_CAP_THRESHOLD,
                 "effect": "level stepped down one band"},
                {"when": "coverage < %g" % COVERAGE_SOFT_THRESHOLD,
                 "effect": "level capped at %s" % COVERAGE_SOFT_CAP},
                {"when": "every contribution is a differential",
                 "effect": "level capped at Low"},
                {"when": "every supporting result is flagged for checking",
                 "effect": "level held at Limited (urgent conditions keep their level)"},
            ],
            "direct_exemption": ("A direct finding - one measured value meeting a configured "
                                 "single-marker criterion - is exempt from the coverage cap."),
            "notes": ["Data sufficiency can only lower a level, never raise it."],
        },
        "urgency": {
            "urgent_score_floor": URGENT_SCORE_FLOOR,
            "rule": ("A condition whose Disease Master tier is 'emergency' (or whose primary "
                     "cohort escalates to it) is listed as time-critical once its score "
                     "reaches the urgent floor - gated on the score, not on the coverage-capped "
                     "level, so a lone critical value still warns."),
        },
        "presentation_tiers": {
            "direct": "one measured value meets a configured threshold that establishes it",
            "derived": "as direct, but the establishing value was calculated by this engine",
            "pattern": "a multi-marker association worth exploring; a hypothesis, not a finding",
            "insufficient": "assessed, but the evidence does not support reporting it",
        },
    }


def _value(p):
    return p.value if p.value is not None else (p.status or p.category)


class Explainer:
    def __init__(self, config, risk_engine):
        self.cfg = config
        self.risk_engine = risk_engine

    # ------------------------------------------------------------------ public

    def build(self, patient, cohort_hits, cohorts_skipped, cohorts_suppressed,
              risks, risks_suppressed, recommendations):
        graph = self._graph(patient, cohort_hits, risks, recommendations)
        return {
            "graph": graph,
            "traces": [self._trace(r, patient, cohort_hits, recommendations, graph)
                       for r in risks],
            "parameter_links": self._parameter_links(graph, risks),
            "cohort_evaluation": self._cohort_evaluation(
                patient, cohort_hits, cohorts_skipped, cohorts_suppressed),
            "condition_candidates": self._condition_candidates(
                cohort_hits, risks, risks_suppressed),
            # Names for every parameter id the analysis refers to, including the ones
            # that were NOT measured - coverage gaps are otherwise only bare ids.
            "parameter_names": self._names(patient, cohort_hits, risks),
            # The thresholds every level in this analysis was read against, so a reader
            # can place a score on the scale without a second request.
            "scale": {"evidence_bands": [{"level": label, "min_score": t}
                                         for t, label in EVIDENCE_BANDS],
                      "reporting_floor": REPORT_FLOOR,
                      "urgent_score_floor": URGENT_SCORE_FLOOR,
                      "contribution_ceiling": CONTRIBUTION_CEILING,
                      "role_factor": dict(ROLE_FACTOR)},
        }

    def _names(self, patient, cohort_hits, risks):
        ids = set(patient.parameters)
        for h in cohort_hits:
            ids |= set(h.parameters_observed) | set(h.parameters_missing)
        for r in risks:
            ids |= set(r.missing_parameters)
        return {pid: self._pname(pid) for pid in sorted(ids)}

    # ------------------------------------------------------------------ graph

    def _graph(self, patient, cohort_hits, risks, recommendations):
        nodes, edges = {}, {}

        def add_edge(source, target, kind, basis, **data):
            if source not in nodes or target not in nodes:
                return
            key = (source, target)
            prev = edges.get(key)
            if prev is not None:
                if _precedence(kind) >= _precedence(prev["kind"]):
                    if basis not in prev["also"]:
                        prev["also"].append(basis)
                    return
                data_also = prev["also"] + [prev["basis"]]
            else:
                data_also = []
            edges[key] = {"id": "%s>%s" % key, "source": source, "target": target,
                          "kind": kind, "basis": basis, "also": data_also, **data}

        def param_node(p):
            nid = "p:" + p.parameter_id
            if nid not in nodes:
                nodes[nid] = {
                    "id": nid, "type": "parameter", "ref": p.parameter_id, "label": p.name,
                    "profile": p.profile, "value": _value(p), "unit": p.unit,
                    "abnormal": p.abnormal, "direction": p.direction,
                    "grade_label": p.grade_label, "reference_low": p.reference_low,
                    "reference_high": p.reference_high,
                    "reference_source": p.reference_source,
                    "finding_basis": p.finding_basis, "derived": p.derived,
                    "data_quality": p.data_quality,
                }
            return nid

        # --- patterns and the results that fired them ----------------------
        for hit in cohort_hits:
            cohort = self.cfg.cohort_by_id[hit.cohort_id]
            cid = "c:" + hit.cohort_id
            nodes[cid] = {
                "id": cid, "type": "cohort", "ref": hit.cohort_id, "label": hit.name,
                "category": hit.category, "mode": hit.mode, "confidence": hit.confidence,
                "data_coverage": hit.data_coverage,
                "parameters_observed": len(hit.parameters_observed),
                "parameters_expected": len(hit.parameters_observed) + len(hit.parameters_missing),
                "profiles": hit.profiles_touched,
                "cross_profile": bool(hit.cross_profile_rationale),
                "urgency_override": hit.urgency_override,
                "citations": len(cohort.get("evidence", [])),
            }
            for h in hit.hits:
                if h.effective_weight <= 0:
                    continue        # matched, but superseded by a stronger condition
                p = patient.get(h.parameter_id)
                if p is None:
                    continue
                add_edge(param_node(p), cid, h.role,
                         "cohorts[%s].hits[%s]" % (hit.cohort_id, h.parameter_id),
                         rule=h.label, observed=h.observed, weight=h.weight,
                         effective_weight=h.effective_weight, discounted=h.suppressed_by)

        # --- conditions, pooled from pattern contributions ------------------
        for r in risks:
            did = "d:" + r.disease_id
            nodes[did] = {
                "id": did, "type": "condition", "ref": r.disease_id,
                "label": r.display_name or r.name, "dm_name": r.name,
                "classification": r.classification, "score": r.score,
                "evidence_level": r.evidence_level, "tier": r.presentation_tier,
                "finding_type": r.finding_type, "urgency_tier": r.urgency_tier,
                "data_coverage": r.data_coverage, "capped": r.evidence_capped,
                "icd10": r.icd10, "profiles": r.profiles,
            }
            for c in r.contributions:
                add_edge("c:" + c.cohort_id, did, "maps_to",
                         "disease_risks[%s].contributions[%s]" % (r.disease_id, c.cohort_id),
                         role=c.role, link_weight=c.link_weight,
                         cohort_confidence=c.cohort_confidence,
                         role_factor=ROLE_FACTOR.get(c.role, 0.5),
                         support_penalty=c.support_penalty, support_note=c.support_note,
                         contribution=c.contribution, dm_basis=c.dm_basis)
            ev = r.direct_evidence or {}
            if ev.get("parameter_id"):
                p = patient.get(ev["parameter_id"])
                if p is not None:
                    add_edge(param_node(p), did, "direct_criterion",
                             "disease_risks[%s].direct_evidence" % r.disease_id,
                             observed=ev.get("observed"), statement=ev.get("statement"),
                             threshold_source=ev.get("threshold_source"))

        # --- action-plan steps ---------------------------------------------
        risk_by_name = {r.name: r for r in risks}
        cohort_by_name = {h.name: h for h in cohort_hits}
        param_by_name = {p.name: p for p in patient.parameters.values()}
        unlinked = 0
        for rec in recommendations:
            aid = "a:" + rec.id
            nodes[aid] = {
                "id": aid, "type": "action", "ref": rec.id,
                "label": rec.finding_display or rec.finding or rec.category,
                "category": rec.category, "priority": rec.priority, "text": rec.text,
                "trace": rec.trace, "timeframe": rec.timeframe,
            }
            before = len(edges)
            risk = risk_by_name.get(rec.finding)
            if risk is not None and rec.finding_kind in ("condition", "direct"):
                add_edge("d:" + risk.disease_id, aid, "addresses",
                         "recommendations[%s].finding" % rec.id)
            if rec.finding_kind == "pattern" and rec.finding in cohort_by_name:
                add_edge("c:" + cohort_by_name[rec.finding].cohort_id, aid, "addresses",
                         "recommendations[%s].finding" % rec.id)
            if rec.trace == "cohort_action" and ("c:" + rec.trace_detail) in nodes:
                add_edge("c:" + rec.trace_detail, aid, "cohort_action",
                         "recommendations[%s].trace_detail" % rec.id)
            if rec.trace == "parameter_action":
                p = patient.get(rec.trace_detail)
                if p is not None:
                    add_edge(param_node(p), aid, "parameter_action",
                             "recommendations[%s].trace_detail" % rec.id)
            for s in rec.sources:
                if s in cohort_by_name:
                    add_edge("c:" + cohort_by_name[s].cohort_id, aid, "source",
                             "recommendations[%s].sources" % rec.id)
                elif s in risk_by_name:
                    add_edge("d:" + risk_by_name[s].disease_id, aid, "source",
                             "recommendations[%s].sources" % rec.id)
            for v in rec.values:
                p = patient.get(v.get("parameter_id"))
                if p is not None:
                    add_edge(param_node(p), aid, "cites",
                             "recommendations[%s].values" % rec.id)
            if rec.trace == "coverage_gap":
                wanted = set(rec.sources)
                for r in risks:
                    missing = {self._pname(pid) for pid in r.missing_parameters}
                    if missing & wanted:
                        add_edge("d:" + r.disease_id, aid, "would_test",
                                 "disease_risks[%s].missing_parameters" % r.disease_id)
            if len(edges) == before:
                # General advice ("applies to every report") has no evidence behind it to
                # draw. It stays in the action plan; it is simply not a graph node.
                del nodes[aid]
                unlinked += 1

        node_list = list(nodes.values())
        edge_list = list(edges.values())
        counts = {}
        for n in node_list:
            counts[n["type"]] = counts.get(n["type"], 0) + 1
        return {
            "nodes": node_list,
            "edges": edge_list,
            "stats": {
                "nodes": counts,
                "edges": len(edge_list),
                "actions_without_evidence_link": unlinked,
                "abnormal_parameters_not_in_graph": sum(
                    1 for p in patient.parameters.values()
                    if p.abnormal and ("p:" + p.parameter_id) not in nodes),
            },
            "columns": ["parameter", "cohort", "condition", "action"],
        }

    # ------------------------------------------------------------------ traces

    def _trace(self, risk, patient, cohort_hits, recommendations, graph):
        by_cohort = {h.cohort_id: h for h in cohort_hits}
        pids = [t["parameter_id"] for t in risk.triggering_parameters]
        ev = risk.direct_evidence or {}
        if ev.get("parameter_id") and ev["parameter_id"] not in pids:
            pids.insert(0, ev["parameter_id"])
        params = [patient.get(pid) for pid in pids]
        params = [p for p in params if p is not None]

        inputs, normalised, graded = [], [], []
        for p in params:
            raw = p.raw
            pdef = self.cfg.param_by_id.get(p.parameter_id, {})
            inputs.append({
                "parameter_id": p.parameter_id,
                "raw_name": raw.raw_name if raw else None,
                "raw_value": raw.raw_value if raw else None,
                "raw_unit": raw.raw_unit if raw else None,
                "raw_range": raw.raw_range if raw else None,
                "raw_flag": raw.raw_flag if raw else None,
                "source_kind": raw.source_kind if raw else "derived",
                "source_path": raw.source_path if raw else None,
                "derived": p.derived,
                "derivation": p.derivation,
                "derived_from": [self._pname(i) for i in
                                 (pdef.get("derived_from") or {}).get("inputs", [])]
                if p.derived else [],
            })
            normalised.append({
                "parameter_id": p.parameter_id, "name": p.name, "profile": p.profile,
                "value": _value(p), "unit": p.unit, "conversion_note": p.conversion_note,
                "reference_low": p.reference_low, "reference_high": p.reference_high,
                "reference_source": p.reference_source, "interpretable": p.interpretable,
            })
            graded.append({
                "parameter_id": p.parameter_id, "name": p.name, "abnormal": p.abnormal,
                "direction": p.direction, "grade": p.grade, "grade_label": p.grade_label,
                "finding_basis": p.finding_basis, "graded_by": p.graded_by,
                "severity_score": p.severity_score, "data_quality": p.data_quality,
                "data_quality_reason": p.data_quality_reason,
                "in_range_but_triggered": (not p.abnormal) and bool(p.triggered_bands),
            })

        patterns = []
        for c in risk.contributions:
            hit = by_cohort.get(c.cohort_id)
            if hit is None:
                continue
            patterns.append({
                "cohort_id": hit.cohort_id, "name": hit.name, "mode": hit.mode,
                "confidence": hit.confidence, "data_coverage": hit.data_coverage,
                "matched": [{"parameter_id": h.parameter_id, "parameter": h.parameter_name,
                             "rule": h.label, "role": h.role, "observed": h.observed,
                             "weight": h.weight, "effective_weight": h.effective_weight,
                             "discounted": h.suppressed_by}
                            for h in hit.hits if h.effective_weight > 0],
                "components_met": hit.components_met,
                "components_unmet": hit.components_unmet,
                "breakdown": hit.confidence_breakdown,
                "citations": [e.get("citation") for e in hit.evidence],
            })

        mapping = [{
            "cohort_id": c.cohort_id, "cohort_name": c.cohort_name,
            "disease_master_row": risk.name, "role": c.role,
            "link_weight": c.link_weight, "role_factor": ROLE_FACTOR.get(c.role, 0.5),
            "cohort_confidence": c.cohort_confidence, "support_penalty": c.support_penalty,
            "support_note": c.support_note, "contribution": c.contribution,
            "dm_basis": c.dm_basis,
        } for c in risk.contributions]

        product = 1.0
        for c in risk.contributions:
            product *= (1.0 - min(CONTRIBUTION_CEILING, c.contribution))
        bd = risk.score_breakdown or {}
        aggregation = {
            "method": "noisy-OR",
            "formula": "1 - product(1 - min(%g, contribution))" % CONTRIBUTION_CEILING,
            "contributions": [round(c.contribution, 4) for c in risk.contributions],
            "recomputed_score": round(1.0 - product, 4),
            "score": risk.score,
            "band_from_score": bd.get("band_from_score"),
            "coverage": risk.data_coverage,
            "cap_applied": bd.get("cap_applied"),
            "final_level": risk.evidence_level,
            "presentation_tier": risk.presentation_tier,
            "direct_evidence": ({
                "parameter": ev.get("parameter"), "observed": ev.get("observed"),
                "statement": ev.get("statement"), "threshold_source": ev.get("threshold_source"),
            } if ev else None),
            "urgency_tier": risk.urgency_tier,
        }

        aid = "d:" + risk.disease_id
        action_ids = sorted({e["target"][2:] for e in graph["edges"]
                             if e["source"] == aid and e["target"].startswith("a:")},
                            key=lambda x: int(x[1:]) if x[1:].isdigit() else 0)
        by_id = {r.id: r for r in recommendations}
        actions = [{"id": a, "category": by_id[a].category, "priority": by_id[a].priority,
                    "text": by_id[a].text, "trace": by_id[a].trace}
                   for a in action_ids if a in by_id]

        steps = [
            {"stage": "input", "title": "Laboratory input", "items": inputs,
             "summary": self._input_summary(inputs)},
            {"stage": "normalization", "title": "Normalization", "items": normalised,
             "summary": "%d result%s resolved to canonical parameters%s." % (
                 len(normalised), "" if len(normalised) == 1 else "s",
                 "; %d unit conversion%s applied" % (
                     sum(1 for n in normalised if n["conversion_note"]),
                     "" if sum(1 for n in normalised if n["conversion_note"]) == 1 else "s")
                 if any(n["conversion_note"] for n in normalised) else "")},
            {"stage": "abnormality", "title": "Abnormality evaluation", "items": graded,
             "summary": "%d of %d outside range; %d decided by a configured guideline band." % (
                 sum(1 for g in graded if g["abnormal"]), len(graded),
                 sum(1 for g in graded if g["finding_basis"] == "decision_threshold"))},
            {"stage": "pattern", "title": "Pattern rules", "items": patterns,
             "summary": "%d cohort rule%s fired: %s." % (
                 len(patterns), "" if len(patterns) == 1 else "s",
                 ", ".join("%s (confidence %.2f)" % (x["name"], x["confidence"])
                           for x in patterns[:4]))},
            {"stage": "mapping", "title": "Disease Master mapping", "items": mapping,
             "summary": "Mapped onto the Disease Master row '%s' through %d link%s." % (
                 risk.name, len(mapping), "" if len(mapping) == 1 else "s")},
            {"stage": "aggregation", "title": "Evidence aggregation", "data": aggregation,
             "summary": "Noisy-OR of %s = %.2f -> %s%s." % (
                 ", ".join("%.3f" % x for x in aggregation["contributions"]), risk.score,
                 risk.evidence_level,
                 " (%s)" % aggregation["cap_applied"] if aggregation["cap_applied"] else "")},
            {"stage": "recommendation", "title": "Action mapping", "items": actions,
             "summary": ("%d action-plan step%s linked to this finding." % (
                 len(actions), "" if len(actions) == 1 else "s")) if actions
             else "No action-plan step is titled by this finding."},
        ]
        return {
            "disease_id": risk.disease_id, "name": risk.name,
            "display_name": risk.display_name or risk.name,
            "presentation_tier": risk.presentation_tier,
            "evidence_level": risk.evidence_level,
            "steps": steps,
            "would_strengthen": {
                "missing_parameters": [{"id": pid, "name": self._pname(pid)}
                                       for pid in risk.missing_parameters],
                "confirmatory_tests": risk.confirmatory_tests,
            },
            "argues_against": risk.contradicting,
            "measured_normal_context": risk.context_values,
        }

    @staticmethod
    def _input_summary(inputs):
        kinds = sorted({i["source_kind"] for i in inputs if i["source_kind"]})
        derived = sum(1 for i in inputs if i["derived"])
        s = "%d result%s read from the %s input" % (
            len(inputs) - derived, "" if len(inputs) - derived == 1 else "s",
            "/".join(k for k in kinds if k != "derived") or "source")
        if derived:
            s += "; %d calculated by this engine from other results" % derived
        return s + "."

    # ------------------------------------------------------------------ indexes

    @staticmethod
    def _parameter_links(graph, risks):
        """For every parameter in the graph: the patterns it fired, the conditions it
        supports, and the plan steps that quote or were produced from it."""
        names = {n["id"]: n["label"] for n in graph["nodes"]}
        out = {}
        for e in graph["edges"]:
            if not e["source"].startswith("p:"):
                continue
            entry = out.setdefault(e["source"][2:], {"cohorts": [], "conditions": [],
                                                     "actions": []})
            tgt = e["target"]
            if tgt.startswith("c:"):
                entry["cohorts"].append({"id": tgt[2:], "name": names[tgt], "rule": e.get("rule"),
                                         "role": e["kind"],
                                         "effective_weight": e.get("effective_weight"),
                                         "discounted": e.get("discounted")})
            elif tgt.startswith("d:"):
                entry["conditions"].append({"id": tgt[2:], "name": names[tgt],
                                            "via": "direct criterion"})
            elif tgt.startswith("a:"):
                entry["actions"].append(tgt[2:])
        for r in risks:
            for t in r.triggering_parameters:
                entry = out.setdefault(t["parameter_id"], {"cohorts": [], "conditions": [],
                                                           "actions": []})
                if not any(c["id"] == r.disease_id for c in entry["conditions"]):
                    entry["conditions"].append({"id": r.disease_id,
                                                "name": r.display_name or r.name,
                                                "via": t.get("via_cohort")})
        return out

    def _cohort_evaluation(self, patient, cohort_hits, skipped, suppressed):
        """What happened to every configured rule, not only the ones that fired."""
        fired = {h.cohort_id: h for h in cohort_hits}
        skipped_by = {s["cohort_id"]: s for s in skipped}
        suppressed_by = {s["cohort_id"]: s for s in suppressed}
        rows = []
        for c in self.cfg.cohorts:
            refs = set(c.get("expected_parameters", []))
            for r in c.get("triggers", []) + c.get("supporting", []):
                refs.add(r["parameter"])
            for comp in c.get("components", []):
                for r in comp["any_of"]:
                    refs.add(r["parameter"])
            present = sum(1 for pid in refs if patient.present(pid))
            row = {"id": c["id"], "name": c["name"], "category": c.get("category"),
                   "mode": c.get("mode", "weighted"), "parameters_present": present,
                   "parameters_referenced": len(refs)}
            if c["id"] in fired:
                row.update(status="fired", confidence=fired[c["id"]].confidence)
            elif c["id"] in suppressed_by:
                row.update(status="suppressed", reason=suppressed_by[c["id"]].get("reason"))
            elif c["id"] in skipped_by:
                row.update(status="not_assessable", reason=skipped_by[c["id"]]["reason"])
            elif c.get("sex_restriction") and patient.context.sex not in (None, c["sex_restriction"]):
                row.update(status="not_applicable",
                           reason="applies to %s patients only" % c["sex_restriction"])
            elif present == 0:
                row.update(status="no_data", reason="none of its parameters were measured")
            else:
                row.update(status="not_met",
                           reason="parameters measured, but the rule's conditions were not met")
            rows.append(row)
        totals = {}
        for r in rows:
            totals[r["status"]] = totals.get(r["status"], 0) + 1
        return {"configured": len(rows), "totals": totals, "rules": rows}

    def _condition_candidates(self, cohort_hits, risks, risks_suppressed):
        """Every Disease Master row a fired pattern links to, and what became of it."""
        reported = {r.name for r in risks}
        vetoed = {s["disease"] for s in risks_suppressed}
        links = {}
        for hit in cohort_hits:
            for link in self.cfg.cohort_by_id[hit.cohort_id].get("diseases", []):
                links.setdefault(link["name"], []).append((hit, link))
        rows = []
        for name in sorted(links):
            if name in reported:
                status = "reported"
            elif name in vetoed:
                status = "suppressed_by_exclusion"
            elif not any(self.risk_engine._link_applies(h, l) for h, l in links[name]):
                status = "gated"         # requires_any markers did not fire
            else:
                status = "below_reporting_floor"
            rows.append({"name": name, "status": status,
                         "via": sorted({h.name for h, _ in links[name]})})
        totals = {}
        for r in rows:
            totals[r["status"]] = totals.get(r["status"], 0) + 1
        return {"linked_from_fired_patterns": len(rows), "totals": totals, "rows": rows,
                "reporting_floor": REPORT_FLOOR}

    def _pname(self, pid):
        p = self.cfg.param_by_id.get(pid)
        return p["name"] if p else pid
