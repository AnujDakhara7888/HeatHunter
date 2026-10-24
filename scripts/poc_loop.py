"""Gate-2 scientific proof of concept (spec Section 15): HH09 twin + public engine.

Run from the repository root:
    .venv/bin/python -m scripts.poc_loop [--seeds 2]

Pipeline (all real code paths, nothing hardcoded):
1. Load Kailash's calibrated public template (healthy TRAINING data only).
2. PROVISIONAL PoC threshold tuning (Mihir owns the final thresholds):
   detection/adequacy come from Mihir's ``calibrate_healthy_thresholds`` on
   separate healthy TRAINING houses, covering both diagnosis contexts
   (passive only, and passive + fan). The ambiguity BIC gap is the smallest
   gap at which the leading cause is correct in >= 95% of a separate set of
   faulty TRAINING tuning scenarios.
3. Through Mihir's ``HH09ScenarioService``, create hidden draft, conduction and
   healthy scenarios; diagnose; run the fan test when recommended. When a
   result is ambiguous but no test is recommended, also run a *forced* test,
   labelled as such, to measure what the fan would have shown. Then repair
   confident diagnoses and reveal the truth only after the investigation.
4. Print every number and save ``reports/poc/poc_loop_results.json``.

This is a TRAINING-split proof of concept, not the held-out benchmark (Anuj).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from collections import Counter
from pathlib import Path

from backend.app.contracts import (
    DiagnoseRequest,
    Diagnosis,
    DiagnosisStatus,
    ExperimentRequest,
    FaultType,
    HypothesisType,
    RepairRequest,
    ScenarioCreateRequest,
    Split,
)
from backend.data_pipeline import list_weather_nights
from backend.diagnosis import DiagnosisController, Thresholds
from backend.diagnosis.controller import calibrate_healthy_thresholds
from backend.engine import PublicModelEngine, PublicMoneyEstimator, load_public_template
from backend.simulation import HH09ScenarioService
from backend.simulation.observations import (
    fan_protocol,
    nighttime_weather,
    passive_protocol,
    simulate_night,
    sub_seed,
)
from backend.simulation.physics import Fault, build_house, inject_fault
from backend.simulation.weather_bridge import load_simulation_weather

THRESHOLD_SEED_BASE = 920_000  # healthy tuning houses
SCENARIO_SEED_BASE = 930_000  # PoC scenarios (never used for tuning)
AMBIGUITY_SEED_BASE = 940_000  # faulty tuning scenarios
TARGET_PRECISION = 0.95
ROOMS = ("living_room", "kitchen", "bedroom_1", "bedroom_2")
SEVERITIES = (1.0, 2.0, 3.0)
OUTPUT = Path(__file__).resolve().parents[1] / "reports" / "poc" / "poc_loop_results.json"


def _training_weather():
    catalog = list_weather_nights(Split.TRAINING.value)
    weathers = {n["night_id"]: nighttime_weather(load_simulation_weather(n["night_id"])) for n in catalog}
    calm = [n["night_id"] for n in catalog if n["weather_regime"] == "calm"]
    return weathers, calm


def _nights(house, weathers, passive_id, fan_id, sensor_seed, with_fan):
    passive = simulate_night(house, weathers[passive_id], passive_protocol(), sensor_seed=sensor_seed)
    nights = [passive.observations]
    if with_fan:
        fan_weather = weathers[fan_id]
        protocol = fan_protocol(fan_weather.outdoor_temperature.timestamps[0])
        nights.append(simulate_night(house, fan_weather, protocol, sensor_seed=sensor_seed).observations)
    return nights


def healthy_threshold_cases(count: int) -> list[list]:
    """Each healthy tuning house contributes a passive-only case and a passive + fan case."""

    weathers, calm = _training_weather()
    cases = []
    for h in range(count):
        seed = THRESHOLD_SEED_BASE + h
        house = build_house(sub_seed(seed, "threshold-house") % 2**63)
        sensor_seed = sub_seed(seed, "threshold-sensors") % 2**63
        passive_id = calm[h % len(calm)]
        fan_id = [n for n in weathers if n != passive_id][h % (len(weathers) - 1)]
        for with_fan in (False, True):
            cases.append(_nights(house, weathers, passive_id, fan_id, sensor_seed, with_fan))
    return cases


def tune_on_faulty_training(engine, template, seeds: int) -> tuple[float, float, dict]:
    """Ambiguity gap and correct-model fit quality from separate faulty TRAINING scenarios.

    * ambiguity: smallest passive BIC gap whose leading cause is right
      >= TARGET_PRECISION of the time;
    * correct-model RMSE: 95th percentile of the TRUE hypothesis's residual RMSE
      in the true room, passive only and passive + fan. A room explained this
      well by the right cause must not be called "unexplained".

    Labels are allowed here because these are training-only tuning scenarios;
    PoC scenarios are never seen.
    """

    weathers, calm = _training_weather()
    outcomes, correct_rmse = [], []
    seed = AMBIGUITY_SEED_BASE
    for _ in range(seeds):
        for fault in (FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION):
            for room in ROOMS:
                for severity in SEVERITIES:
                    seed += 1
                    house = build_house(sub_seed(seed, "ambiguity-house") % 2**63)
                    faulty = inject_fault(house, Fault(fault, room, severity))
                    passive_id = calm[seed % len(calm)]
                    fan_id = [n for n in weathers if n != passive_id][seed % (len(weathers) - 1)]
                    both = _nights(faulty, weathers, passive_id, fan_id, seed, True)
                    for nights in (both[:1], both):
                        fits = {
                            cause: engine.fit_hypothesis(nights, room, template, cause)
                            for cause in (HypothesisType.DRAFT, HypothesisType.ENVELOPE_CONDUCTION)
                        }
                        correct_rmse.append(fits[HypothesisType(fault.value)].residual_rmse_deg_c)
                        if len(nights) == 1:
                            best, second = sorted(fits.values(), key=lambda f: f.bic)
                            outcomes.append((second.bic - best.bic, best.fault_type.value == fault.value))
    candidates = sorted({0.0, *(gap for gap, _ in outcomes)})
    threshold = candidates[-1] + 1.0
    for candidate in candidates:
        confident = [ok for gap, ok in outcomes if gap >= candidate]
        if confident and sum(confident) / len(confident) >= TARGET_PRECISION:
            threshold = max(candidate, 2.0)
            break
    confident = [ok for gap, ok in outcomes if gap >= threshold]
    adequacy = sorted(correct_rmse)[math.ceil(0.95 * len(correct_rmse)) - 1]
    return (
        threshold,
        adequacy,
        {
            "tuning_scenarios": len(outcomes),
            "precision_target": TARGET_PRECISION,
            "confident_fraction": round(len(confident) / len(outcomes), 3),
            "confident_precision": round(sum(confident) / len(confident), 3) if confident else None,
            "wrong_leader_gaps": sorted(round(gap, 1) for gap, ok in outcomes if not ok),
            "correct_model_rmse_p95_deg_c": round(adequacy, 4),
        },
    )


def summarize(diagnosis: Diagnosis) -> dict:
    causes = [
        {
            "cause": f.fault_type.value,
            "multiplier": round(f.fitted_multiplier, 3),
            "bic": round(f.bic, 2),
            "rmse": round(f.residual_rmse_deg_c, 4),
        }
        for f in diagnosis.ranked_causes
    ]
    decision = diagnosis.test_decision
    return {
        "status": diagnosis.status.value,
        "flagged_room": diagnosis.flagged_room_id,
        "ranked_causes": causes,
        "cause_gap_bic": round(causes[1]["bic"] - causes[0]["bic"], 2) if len(causes) > 1 else None,
        "evidence": [e.statement for e in diagnosis.evidence],
        "test_recommended": bool(decision and decision.recommended),
        "separation_score": round(decision.separation_score, 3)
        if decision and decision.separation_score is not None
        else None,
        "test_explanation": decision.explanation if decision else None,
        "money_usd_per_year": round(diagnosis.money_estimate.annual_cost_estimate_usd, 2)
        if diagnosis.money_estimate
        else None,
    }


async def investigate(service: HH09ScenarioService, fault: FaultType, room: str, severity: float, seed: int):
    created = await service.create_scenario(
        ScenarioCreateRequest(
            mode="judge", judge_fault_type=fault, judge_room_id=room, severity=severity, seed=seed
        )
    )
    sid = created.scenario_id
    record = {"seed": seed}
    before = await service.diagnose(sid, DiagnoseRequest())
    record["passive"] = summarize(before)
    after = before
    if before.status == DiagnosisStatus.AMBIGUOUS:
        forced = not (before.test_decision and before.test_decision.recommended)
        experiment = await service.run_experiment(
            sid,
            ExperimentRequest(
                diagnosis_id=before.diagnosis_id, experiment_type="exhaust_fan_depressurization"
            ),
            force_for_evaluation=forced,
        )
        after = experiment.updated_diagnosis
        record["experiment"] = {"forced": forced, "night_id": experiment.observations.night_id}
        record["after_test"] = summarize(after)
    if after.status == DiagnosisStatus.CONFIDENT:
        repair = await service.apply_repair(sid, RepairRequest(diagnosis_id=after.diagnosis_id))
        record["repair"] = {
            "repair_type": repair.repair_type.value,
            "summary": repair.diagnosed_improvement,
            "remeasured_savings_kwh": repair.remeasured_savings_kwh,
            "estimated_annual_cost_usd": round(repair.estimated_savings.annual_cost_estimate_usd, 2)
            if repair.estimated_savings
            else None,
            "payback_years": round(repair.estimated_savings.simple_payback_years, 1)
            if repair.estimated_savings and repair.estimated_savings.simple_payback_years
            else None,
        }
    truth = await service.reveal(sid)  # only after the investigation is complete
    record["truth"] = {
        "fault": truth.fault_type.value,
        "room": truth.actual_room_id,
        "severity": truth.severity,
        "diagnosis_matched": truth.diagnosis_matched,
        "repair_addressed_cause": truth.repair_addressed_cause,
    }
    service.discard(sid)
    return record


def final_view(record: dict) -> dict:
    return record.get("after_test", record["passive"])


def correct_cause(view: dict, truth: dict) -> bool:
    return (
        bool(view["ranked_causes"])
        and view["flagged_room"] == truth["room"]
        and (view["ranked_causes"][0]["cause"] == truth["fault"])
    )


def report(records: list[dict], thresholds) -> dict:
    faulty = [r for r in records if r["truth"]["fault"] != "none"]
    healthy = [r for r in records if r["truth"]["fault"] == "none"]
    ambiguous = [r for r in faulty if r["passive"]["status"] == "ambiguous"]
    amb_right_room = [r for r in ambiguous if r["passive"]["flagged_room"] == r["truth"]["room"]]
    recommended = [r for r in ambiguous if r["passive"]["test_recommended"]]

    def rate(items, predicate):
        return f"{sum(map(predicate, items))}/{len(items)}" if items else "0/0"

    by_severity = {}
    for severity in SEVERITIES:
        subset = [r for r in faulty if r["truth"]["severity"] == severity]
        by_severity[str(severity)] = {
            "passive_status": dict(Counter(r["passive"]["status"] for r in subset)),
            "passive_room_correct": rate(
                subset, lambda r: r["passive"]["flagged_room"] == r["truth"]["room"]
            ),
            "final_matched_truth": rate(subset, lambda r: r["truth"]["diagnosis_matched"]),
        }
    gaps = [
        r["passive"]["cause_gap_bic"] for r in amb_right_room if r["passive"]["cause_gap_bic"] is not None
    ]
    sensitivity = {
        str(threshold): rate(
            [
                r
                for r in faulty
                if r["passive"]["flagged_room"] == r["truth"]["room"] and r["passive"]["ranked_causes"]
            ],
            lambda r, t=threshold: (r["passive"]["cause_gap_bic"] or 0) >= t,
        )
        for threshold in (2.0, 6.0, 10.0, 20.0)
    }
    return {
        "thresholds": {
            "detection_bic": thresholds.detection_bic,
            "ambiguity_bic (provisional)": thresholds.ambiguity_bic,
            "adequacy_rmse_deg_c": thresholds.adequacy_rmse,
            "separation": thresholds.separation,
            "measurement_noise_deg_c": thresholds.measurement_noise,
            "note": thresholds.calibration_note,
        },
        "counts": {"faulty": len(faulty), "healthy": len(healthy)},
        "passive_status_faulty": dict(Counter(r["passive"]["status"] for r in faulty)),
        "passive_status_healthy": dict(Counter(r["passive"]["status"] for r in healthy)),
        "healthy_false_alarms(confident or ambiguous)": rate(
            healthy, lambda r: r["passive"]["status"] in ("confident", "ambiguous")
        ),
        "passive_room_correct(faulty)": rate(
            faulty, lambda r: r["passive"]["flagged_room"] == r["truth"]["room"]
        ),
        "by_severity": by_severity,
        "ambiguous_cases": len(ambiguous),
        "ambiguous_with_correct_room": len(amb_right_room),
        "fan_test_recommended": rate(ambiguous, lambda r: r["passive"]["test_recommended"]),
        "separation_scores_ambiguous": sorted(
            r["passive"]["separation_score"]
            for r in ambiguous
            if r["passive"]["separation_score"] is not None
        ),
        "passive_top_cause_correct(ambiguous, right room)": rate(
            amb_right_room, lambda r: r["passive"]["ranked_causes"][0]["cause"] == r["truth"]["fault"]
        ),
        "after_test_top_cause_correct(ambiguous, right room)": rate(
            amb_right_room, lambda r: correct_cause(r["after_test"], r["truth"])
        ),
        "after_test_status(ambiguous, right room)": dict(
            Counter(r["after_test"]["status"] for r in amb_right_room)
        ),
        "after_recommended_test_correct": rate(
            recommended, lambda r: correct_cause(r["after_test"], r["truth"])
        ),
        "passive_cause_gap_bic_ambiguous_median": statistics.median(gaps) if gaps else None,
        "passive_cause_gap_at_least(threshold) among right-room fault cases": sensitivity,
        "final_diagnosis_matched_truth": rate(records, lambda r: r["truth"]["diagnosis_matched"]),
        "repairs_addressing_cause": rate(
            [r for r in records if "repair" in r], lambda r: bool(r["truth"]["repair_addressed_cause"])
        ),
    }


async def main_async(args) -> None:
    started = time.perf_counter()
    template = load_public_template()
    engine = PublicModelEngine()
    ambiguity, faulty_rmse, ambiguity_report = tune_on_faulty_training(engine, template, args.ambiguity_seeds)
    cases = healthy_threshold_cases(args.threshold_houses)
    passive_cases = [case for case in cases if len(case) == 1]
    detection = calibrate_healthy_thresholds(engine, template, passive_cases, ambiguity_bic=ambiguity)
    healthy_all = calibrate_healthy_thresholds(engine, template, cases, ambiguity_bic=ambiguity)
    adequacy = max(healthy_all.adequacy_rmse, faulty_rmse)
    thresholds = Thresholds(
        detection_bic=detection.detection_bic,
        ambiguity_bic=ambiguity,
        adequacy_rmse=adequacy,
        separation=detection.separation,
        measurement_noise=detection.measurement_noise,
        calibration_note=(
            "PROVISIONAL PoC tuning (Mihir owns final thresholds): detection = 95th-percentile healthy "
            f"TRAINING maxima over {len(passive_cases)} passive cases; adequacy = max(healthy p95 over "
            f"{len(cases)} passive and passive+fan cases, correct-model p95 on faulty TRAINING tuning); "
            f"ambiguity = smallest passive BIC gap with >= {TARGET_PRECISION:.0%} leading-cause precision "
            f"on {ambiguity_report['tuning_scenarios']} faulty TRAINING tuning scenarios."
        ),
    )
    ambiguity_report["healthy_adequacy_p95_deg_c"] = round(healthy_all.adequacy_rmse, 4)
    print(f"Thresholds: {thresholds}")
    print(f"Ambiguity tuning: {ambiguity_report}")
    controller = DiagnosisController(engine, template, thresholds)
    service = HH09ScenarioService(controller, financial_estimator=PublicMoneyEstimator(template))

    records = []
    seed = SCENARIO_SEED_BASE
    for s in range(args.seeds):
        for fault in (FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION):
            for room in ROOMS:
                for severity in SEVERITIES:
                    seed += 1
                    records.append(await investigate(service, fault, room, severity, seed))
        for _ in range(len(ROOMS)):
            seed += 1
            records.append(await investigate(service, FaultType.NONE, ROOMS[0], 1.0, seed))
        print(f"  seed block {s + 1}/{args.seeds}: {len(records)} scenarios")

    for r in records:
        p, f = r["passive"], final_view(r)
        truth = r["truth"]
        test = r.get("experiment")
        print(
            f"truth={truth['fault']:<19} room={str(truth['room']):<11} sev={truth['severity']:<3} | "
            f"passive={p['status']:<11} flag={str(p['flagged_room']):<11} "
            f"top={(p['ranked_causes'] or [{'cause': '-'}])[0]['cause']:<19} gap={p['cause_gap_bic']} "
            f"sep={p['separation_score']} | "
            + (
                f"test({'forced' if test['forced'] else 'recommended'})->{f['status']} "
                f"top={(f['ranked_causes'] or [{'cause': '-'}])[0]['cause']} "
                if test
                else ""
            )
            + f"| matched={truth['diagnosis_matched']}"
        )
    summary = report(records, thresholds)
    summary["ambiguity_tuning"] = ambiguity_report
    summary["runtime_seconds"] = round(time.perf_counter() - started, 1)
    print(json.dumps(summary, indent=2))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(
            {
                "title": "HeatHunter Gate-2 proof of concept (TRAINING split, not the held-out benchmark)",
                "summary": summary,
                "scenarios": records,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Saved {OUTPUT}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, default=2)
    parser.add_argument("--threshold-houses", type=int, default=40)
    parser.add_argument("--ambiguity-seeds", type=int, default=2)
    asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    main()
