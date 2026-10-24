"""Train conservative phase-specific decisions on TRAINING weather/house seeds.

No held-out sensor observations are generated, scored or used to pick settings.
Optional fit cache is a labelled research artifact, never a runtime data source.
Run: python -m backend.simulation.train_decisions --cache /tmp/hh09-training-fits.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from backend.app.contracts import FaultType, HypothesisType, Split
from backend.data_pipeline import list_weather_nights
from backend.diagnosis import DecisionProfiles, Thresholds
from backend.diagnosis.settings import fingerprints, profile_payload, write_settings
from backend.engine import PublicModelEngine, load_public_template

from .experiment_policy import CalmFanPolicy
from .observations import fan_protocol, nighttime_weather, passive_protocol, simulate_night, sub_seed
from .physics import Fault, build_house, inject_fault
from .runtime import OPERATING_ASSETS, SIMULATOR_ASSETS
from .weather_bridge import load_simulation_weather

REPORT_PATH = Path(__file__).with_name("reports") / "decision_training_report.json"
ROOMS = ("living_room", "kitchen", "bedroom_1", "bedroom_2")
STAGES = ("passive", "post_fan")
DESIGN = {"healthy_tuning": 60, "fault_tuning": 96, "healthy_check": 30, "fault_check": 64}
BASES = {"healthy_tuning": 960000, "fault_tuning": 961000, "healthy_check": 962000, "fault_check": 963000}
TARGET_PRECISION = 0.95
MIN_CONFIDENT_SUPPORT = 12


def percentile(values: list[float], q: float) -> float:
    return sorted(values)[max(0, math.ceil(q * len(values)) - 1)]


def describe(
    fits: dict,
    threshold: Thresholds,
    *,
    passive_fits: dict | None = None,
    passive_threshold: Thresholds | None = None,
) -> dict:
    """Evaluate cached public fits using exactly the controller's decision rules.

    No truth is consulted here. Kept small so a real-controller equivalence test
    can prevent this offline selector drifting from the runtime decision logic.
    """
    ranked = {
        r: sorted((f["draft"], f["envelope_conduction"]), key=lambda x: (x["bic"], x["fault_type"]))
        for r, f in fits.items()
    }
    scores = {r: f["normal"]["bic"] - ranked[r][0]["bic"] for r, f in fits.items()}
    flagged = max(sorted(fits), key=lambda r: scores[r])
    best, second = ranked[flagged]
    status = "confident"
    if any(
        min(x["residual_rmse_deg_c"] for x in f.values()) > threshold.adequacy_rmse for f in fits.values()
    ):
        status = "unexplained"
        flagged_result = None
    elif scores[flagged] <= threshold.detection_bic:
        status = "no_fault"
        flagged_result = None
        if passive_fits is not None and passive_threshold is not None:
            earlier = describe(passive_fits, passive_threshold)
            if earlier["status"] in {"ambiguous", "confident"}:
                status, flagged_result = "unexplained", earlier["room"]
    elif best["residual_rmse_deg_c"] > threshold.adequacy_rmse or best["fitted_multiplier"] <= 1:
        status = "unexplained"
        flagged_result = flagged
    else:
        status = (
            "ambiguous"
            if not threshold.confidence_enabled or second["bic"] - best["bic"] < threshold.ambiguity_bic
            else "confident"
        )
        flagged_result = flagged
    return {
        "status": status,
        "room": flagged_result,
        "cause": best["fault_type"],
        "gap": second["bic"] - best["bic"],
        "score": scores[flagged],
    }


def correct(result: dict, row: dict) -> bool:
    if row["truth"]["fault"] == "none":
        return result["status"] == "no_fault"
    return (
        result["status"] == "confident"
        and result["room"] == row["truth"]["room"]
        and result["cause"] == row["truth"]["fault"]
    )


def metrics(
    rows: list[dict], stage: str, threshold: Thresholds, passive_threshold: Thresholds | None = None
) -> dict:
    predictions = [
        (
            row,
            describe(
                row["fits"][stage],
                threshold,
                passive_fits=row["fits"]["passive"] if stage == "post_fan" else None,
                passive_threshold=passive_threshold,
            ),
        )
        for row in rows
    ]
    confident = [(r, p) for r, p in predictions if p["status"] == "confident"]
    healthy = [(r, p) for r, p in predictions if r["truth"]["fault"] == "none"]
    return {
        "cases": len(rows),
        "statuses": dict(Counter(p["status"] for _, p in predictions)),
        "confident_count": len(confident),
        "confident_precision": (
            sum(correct(p, r) for r, p in confident) / len(confident) if confident else None
        ),
        "healthy_count": len(healthy),
        "healthy_false_alarm_rate": (
            sum(p["status"] in {"ambiguous", "confident"} for _, p in healthy) / len(healthy)
            if healthy
            else None
        ),
        "supported_correct_count": sum(correct(p, r) for r, p in predictions),
        "by_truth": {
            kind: {
                "cases": sum(r["truth"]["fault"] == kind for r in rows),
                "supported_correct": sum(
                    correct(p, r) for r, p in predictions if r["truth"]["fault"] == kind
                ),
            }
            for kind in ("none", "draft", "envelope_conduction")
        },
    }


def fit_profiles(rows: list[dict]) -> tuple[DecisionProfiles, dict]:
    training_ids = {n["night_id"] for n in list_weather_nights(Split.TRAINING.value)}
    if not rows or any(
        not set(r["weather_nights"]) <= training_ids
        or r["truth"].get("provenance") != "SIMULATED_GROUND_TRUTH"
        or r["cohort"] not in {"tuning", "check"}
        for r in rows
    ):
        raise ValueError("Decision fitting requires labelled TRAINING-only records and declared cohorts")
    training = [r for r in rows if r["cohort"] == "tuning"]
    checking = [r for r in rows if r["cohort"] == "check"]
    chosen, report = {}, {}
    for stage in STAGES:
        healthy = [r for r in training if r["truth"]["fault"] == "none"]
        if len(healthy) < 20:
            raise ValueError("At least twenty healthy training cases required for each profile")
        # A maximum-of-house score controls four-room multiple comparisons.
        scores, healthy_errors, faulty_errors = [], [], []
        for row in training:
            fits = row["fits"][stage]
            if row["truth"]["fault"] == "none":
                scores.append(
                    max(
                        f["normal"]["bic"] - min(f[c]["bic"] for c in ("draft", "envelope_conduction"))
                        for f in fits.values()
                    )
                )
                healthy_errors.append(
                    max(min(v["residual_rmse_deg_c"] for v in f.values()) for f in fits.values())
                )
            else:
                faulty_errors.append(fits[row["truth"]["room"]][row["truth"]["fault"]]["residual_rmse_deg_c"])
        healthy_floor = max(0, percentile(scores, 0.99))
        adequacy = max(percentile(healthy_errors, 0.99), percentile(faulty_errors, 0.95), 1e-6)
        common = dict(
            adequacy_rmse=adequacy,
            separation=2,
            calibration_note=f"Conservative {stage}; TRAINING-only joint room/cause cutoff search; "
            "detection floor = healthy house-max BIC p99 times {1.1,1.25,1.5,2}; "
            "prefer highest supported precision then coverage; minimum 12 confident cases.",
        )
        candidate, best_quality = None, (-1.0, -1)
        # Joint tuning prevents a cause gap from legitimizing the wrong room.
        # Only labelled TRAINING records participate in this search.
        for scale in (1.1, 1.25, 1.5, 2.0):
            detection = healthy_floor * scale
            base = Thresholds(detection_bic=detection, ambiguity_bic=0, **common)
            events = []
            for row in training:
                result = describe(row["fits"][stage], base)
                if result["status"] == "confident" and result["gap"] >= 2:
                    events.append((result["gap"], correct(result, row)))
            events.sort(reverse=True)
            count, good = 0, 0
            index = 0
            while index < len(events):
                gap = events[index][0]
                while index < len(events) and events[index][0] == gap:
                    count += 1
                    good += int(events[index][1])
                    index += 1
                precision = good / count
                quality = (precision, good)
                if (
                    count >= MIN_CONFIDENT_SUPPORT
                    and precision >= TARGET_PRECISION
                    and quality > best_quality
                ):
                    candidate = Thresholds(detection_bic=detection, ambiguity_bic=gap, **common)
                    best_quality = quality
        if candidate is None:
            candidate = Thresholds(
                detection_bic=healthy_floor * 2, ambiguity_bic=2, confidence_enabled=False, **common
            )
        before_check = metrics(checking, stage, candidate, chosen.get("passive"))
        # Predeclared conservative safety gate, using separate TRAINING seed
        # cases. This is part of tuning, not an independent held-out claim.
        precision = before_check["confident_precision"]
        safe = (
            (precision is None or precision >= TARGET_PRECISION)
            and before_check["healthy_false_alarm_rate"] <= 0.05
            and (not candidate.confidence_enabled or before_check["confident_count"] >= MIN_CONFIDENT_SUPPORT)
        )
        if not safe:
            candidate = Thresholds(**{**asdict(candidate), "confidence_enabled": False})
        chosen[stage] = candidate
        report[stage] = {
            "healthy_tuning_cases": len(healthy),
            "tuning": metrics(training, stage, candidate, chosen.get("passive")),
            "separate_training_check_before_safety_gate": before_check,
            "confidence_safety_gate_passed": safe,
            "separate_training_check": metrics(checking, stage, candidate, chosen.get("passive")),
        }
    return DecisionProfiles(**chosen), report


def collect_cases(cache: Path | None = None, *, fresh_check: int = 0) -> tuple[list[dict], dict]:
    design = {"healthy_check": 30, "fault_check": 64} if fresh_check else DESIGN
    bases = (
        {"healthy_check": 962000 + 2000 * fresh_check, "fault_check": 963000 + 2000 * fresh_check}
        if fresh_check
        else BASES
    )
    fingerprint = {
        "public_assets": {k: v for k, v in fingerprints().items() if k != "backend/diagnosis/controller.py"},
        "simulator_assets": fingerprints(SIMULATOR_ASSETS),
        "design": design,
        "bases": bases,
        "study_version": 2,
        "weather_assets": fingerprints(
            tuple(
                f"data/weather/hh09/{n['night_id']}.json" for n in list_weather_nights(Split.TRAINING.value)
            )
        ),
    }
    if cache and cache.is_file():
        saved = json.loads(cache.read_text())
        saved.get("fingerprint", {}).get("public_assets", {}).pop("backend/diagnosis/controller.py", None)
        if saved.get("fingerprint") == fingerprint:
            return saved["rows"], fingerprint
    catalog = list_weather_nights(Split.TRAINING.value)
    policy = CalmFanPolicy()
    weathers = []
    all_weathers = []
    for item in catalog:
        weather = nighttime_weather(load_simulation_weather(item["night_id"]))
        all_weathers.append(weather)
        if policy.assess(weather, fan_protocol(weather.outdoor_temperature.timestamps[0]))[0]:
            weathers.append(weather)
    if len(weathers) < 2:
        raise ValueError("two distinct eligible TRAINING calm nights required")
    weathers.sort(key=lambda w: w.night_id)
    engine, template = PublicModelEngine(), load_public_template()
    rows = []
    for name, count in design.items():
        for index in range(count):
            seed = bases[name] + index
            is_healthy = name.startswith("healthy")
            kind = (
                FaultType.NONE
                if is_healthy
                else (FaultType.DRAFT if (index // 16) % 2 == 0 else FaultType.ENVELOPE_CONDUCTION)
            )
            room = None if is_healthy else ROOMS[(index // 4) % 4]
            severity = 0 if is_healthy else (0.6, 1.0, 2.0, 3.0)[index % 4]
            house = build_house(sub_seed(seed, "house") % 2**63)
            faulty = inject_fault(house, Fault(kind, room, severity))
            sensor_seed = sub_seed(seed, "sensors") % 2**63
            # Weather choice is independent of severity/room/category. In
            # particular, do not tie index%4 severity to index%4 weather.
            weather_rng = random.Random(sub_seed(seed, "training-weather"))
            w1 = weather_rng.choice(all_weathers)
            w2 = weather_rng.choice([w for w in weathers if w.night_id != w1.night_id])
            passive = simulate_night(faulty, w1, passive_protocol(), sensor_seed=sensor_seed).observations
            fan = simulate_night(
                faulty, w2, fan_protocol(w2.outdoor_temperature.timestamps[0]), sensor_seed=sensor_seed
            ).observations
            fits = {}
            for stage, nights in (("passive", [passive]), ("post_fan", [passive, fan])):
                fits[stage] = {
                    r: {
                        c.value: engine.fit_hypothesis(nights, r, template, c).model_dump(mode="json")
                        for c in HypothesisType
                    }
                    for r in ROOMS
                }
            rows.append(
                {
                    "seed": seed,
                    "cohort": "check" if name.endswith("check") else "tuning",
                    "truth": {
                        "fault": kind.value,
                        "room": room,
                        "severity": severity,
                        "provenance": "SIMULATED_GROUND_TRUTH",
                    },
                    "weather_nights": [w1.night_id, w2.night_id],
                    "fits": fits,
                }
            )
            if (index + 1) % 10 == 0 or index == count - 1:
                print(f"{name}: {index + 1}/{count}", flush=True)
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"fingerprint": fingerprint, "rows": rows}, indent=2) + "\n")
    return rows, fingerprint


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path)
    parser.add_argument(
        "--refine-on-training-check",
        action="store_true",
        help="Use first training-check failures for tuning, then check disjoint fresh seeds",
    )
    parser.add_argument(
        "--second-refinement",
        action="store_true",
        help="Promote first fresh TRAINING check into tuning, then check another fresh cohort",
    )
    args = parser.parse_args()
    if args.second_refinement and not args.refine_on_training_check:
        parser.error("--second-refinement requires --refine-on-training-check")
    rows, identity = collect_cases(args.cache)
    refinement = None
    if args.refine_on_training_check:
        _, initial_report = fit_profiles(rows)
        fresh_cache = args.cache.with_name(args.cache.stem + "-fresh.json") if args.cache else None
        fresh_rows, fresh_identity = collect_cases(fresh_cache, fresh_check=True)
        rows = [{**r, "cohort": "tuning"} for r in rows] + fresh_rows
        refinement = {
            "first_check_promoted_to_tuning": True,
            "initial_training_check_report": initial_report,
            "fresh_training_check_seed_bases": fresh_identity["bases"],
            "fresh_training_check_design": fresh_identity["design"],
        }
    if args.second_refinement:
        _, previous_report = fit_profiles(rows)
        final_cache = args.cache.with_name(args.cache.stem + "-fresh2.json") if args.cache else None
        final_rows, final_identity = collect_cases(final_cache, fresh_check=2)
        rows = [{**r, "cohort": "tuning"} for r in rows] + final_rows
        refinement["second_refinement"] = {
            "previous_training_check_promoted_to_tuning": True,
            "previous_training_check_report": previous_report,
            "final_training_check_seed_bases": final_identity["bases"],
            "final_training_check_design": final_identity["design"],
        }
    profiles, report = fit_profiles(rows)
    payload = {
        "schema_version": 1,
        "template_id": load_public_template().template_id,
        "profiles": profile_payload(profiles),
        "fan_policy": asdict(CalmFanPolicy()),
        "public_assets": fingerprints(),
        "simulator_assets": identity["simulator_assets"],
        "weather_assets": identity["weather_assets"],
        "operating_assets": fingerprints(OPERATING_ASSETS),
        "training": {
            "training_only": True,
            "case_design": DESIGN,
            "seed_bases": BASES,
            "refinement": refinement,
            "weather_night_ids": sorted({w for r in rows for w in r["weather_nights"]}),
            "purpose": "Conservative operational settings; not a held-out accuracy claim",
            "protocol_design": "Mixed calm/windy passive nights; different calm-only fan night",
            "tuning_case_count": sum(r["cohort"] == "tuning" for r in rows),
            "training_check_case_count": sum(r["cohort"] == "check" for r in rows),
        },
        "validation": report,
    }
    write_settings(payload)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(
        json.dumps(
            {
                "settings": payload,
                "case_decisions": [
                    {
                        "seed": r["seed"],
                        "cohort": r["cohort"],
                        "truth": r["truth"],
                        "weather_nights": r["weather_nights"],
                        **{
                            s: describe(
                                r["fits"][s],
                                getattr(profiles, s),
                                passive_fits=r["fits"]["passive"] if s == "post_fan" else None,
                                passive_threshold=profiles.passive if s == "post_fan" else None,
                            )
                            for s in STAGES
                        },
                    }
                    for r in rows
                ],
            },
            indent=2,
        )
        + "\n"
    )
    print(json.dumps({"profiles": profile_payload(profiles), "report": report}, indent=2))


if __name__ == "__main__":
    main()
