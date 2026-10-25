"""Tune the multi-night flag rule on TRAINING study cases; check it on held-back houses.

Run from the repository root, after ``backend.simulation.monitoring_study``:
    .venv/bin/python -m backend.simulation.tune_monitoring

Rule, per room, after each night k (all nights so far are fitted together):

* the leading fault is whichever of draft / envelope conduction has the lower BIC;
* its *excess heat loss* is the extra seasonal conductance implied by its fitted
  multiplier, as a fraction of the room's nominal seasonal heat-loss conductance;
* the room is a candidate when the excess exceeds ``a + b / sqrt(k)`` for its
  leading cause (strict on early nights, relaxing as evidence accumulates) and
  the fault beats "normal". Each cause has its own ``a`` and ``b``: healthy rooms
  whose best fault is a draft show little excess, while ordinary house-to-house
  variation looks like a sizeable envelope excess;
* it is flagged when it has been a candidate, with the same leading cause, for
  ``persistence`` consecutive nights; the cause is named only when the BIC gap
  between draft and conduction exceeds ``cause_gap``, otherwise the flag says
  "cause not yet clear".

Houses are split in two: even study houses tune the four settings, odd houses
are scored once with the chosen settings and never used for tuning. The
held-out winter is not touched here; it is reserved for the final benchmark.
Constraints on the tuning houses: no healthy house is ever flagged, and at most
``MAX_WRONG`` confident answers name the wrong room or cause. (A limit of one was
infeasible: the best settings call two severe drafts envelope losses, in the
right room.)
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import median

from backend.app.contracts import HypothesisType
from backend.diagnosis.monitoring import DEFAULT_MONITORING_PATH, MONITORING_ASSETS
from backend.diagnosis.settings import fingerprints, write_settings
from backend.engine import excess_fraction, load_public_template
from backend.engine.assumptions import load_assumptions

from .monitoring_study import REPORT_PATH as RAW_PATH

REPORT_PATH = RAW_PATH.with_name("flag_rule_tuning.json")
MAX_WRONG = 2
GRID = {
    "draft_a": [0.03, 0.05, 0.07, 0.09, 0.11, 0.13],
    "draft_b": [0.0, 0.05, 0.1, 0.15, 0.2],
    "envelope_a": [round(0.10 + 0.025 * i, 3) for i in range(11)],
    "envelope_b": [0.0, 0.1, 0.2, 0.3, 0.4],
    "cause_gap": [10.0, 20.0, 40.0],
    "persistence": [1, 2, 3],
}


def features(raw: dict) -> list[dict]:
    """Per case, per night, per room: leading cause, excess fraction, BIC gain over normal, cause gap."""

    template = load_public_template()
    assumptions = load_assumptions()
    out = []
    for case in raw["cases"]:
        nights = []
        for night in case["nights"]:
            rooms = {}
            for room, fits in night["rooms"].items():
                cause = (
                    "draft"
                    if fits["draft"]["bic"] < fits["envelope_conduction"]["bic"]
                    else "envelope_conduction"
                )
                excess = excess_fraction(
                    template, room, HypothesisType(cause), fits[cause]["multiplier"], assumptions=assumptions
                )
                rooms[room] = (
                    cause,
                    excess,
                    fits["normal"]["bic"] - fits[cause]["bic"],
                    abs(fits["draft"]["bic"] - fits["envelope_conduction"]["bic"]),
                )
            nights.append(rooms)
        out.append(
            {key: case[key] for key in ("house", "fault_type", "room", "severity", "seed")}
            | {"nights": nights}
        )
    return out


def run_rule(
    case: dict,
    draft_a: float,
    draft_b: float,
    envelope_a: float,
    envelope_b: float,
    cause_gap: float,
    persistence: int,
) -> dict:
    """Replay the rule night by night. Returns the first flag and the first confident answer."""

    streak: dict[str, tuple[str, int]] = {}
    first_flag = first_confident = None
    for k, rooms in enumerate(case["nights"], start=1):
        threshold = {
            "draft": draft_a + draft_b / math.sqrt(k),
            "envelope_conduction": envelope_a + envelope_b / math.sqrt(k),
        }
        for room, (cause, excess, gain, _gap) in rooms.items():
            if excess > threshold[cause] and gain > 0:
                previous = streak.get(room)
                count = previous[1] + 1 if previous and previous[0] == cause else 1
                streak[room] = (cause, count)
            else:
                streak.pop(room, None)
        flagged = [(room, cause) for room, (cause, count) in streak.items() if count >= persistence]
        if flagged and first_flag is None:
            first_flag = (k, flagged)
        confident = [(room, cause) for room, cause in flagged if rooms[room][3] > cause_gap]
        if confident and first_confident is None:
            first_confident = (k, confident)
    return {"first_flag": first_flag, "first_confident": first_confident}


def score(cases: list[dict], settings: dict) -> dict:
    healthy_flagged = wrong = 0
    found: dict[str, list] = defaultdict(list)
    room_only: dict[str, int] = defaultdict(int)
    for case in cases:
        result = run_rule(case, **settings)
        if case["fault_type"] == "none":
            healthy_flagged += result["first_flag"] is not None
            continue
        key = f"{case['fault_type']} x{1 + case['severity']:.1f}"
        confident = result["first_confident"]
        if confident is None:
            found[key].append(None)
            flag = result["first_flag"]
            room_only[key] += bool(flag and any(room == case["room"] for room, _ in flag[1]))
            continue
        night, answers = confident
        if answers == [(case["room"], case["fault_type"])]:
            found[key].append(night)
        else:
            wrong += 1
            found[key].append(None)
    healthy = sum(c["fault_type"] == "none" for c in cases)
    groups = {}
    for key in sorted(found):
        hits = [n for n in found[key] if n is not None]
        groups[key] = {
            "correct": len(hits),
            "cases": len(found[key]),
            "median_night": median(hits) if hits else None,
            "worst_night": max(hits) if hits else None,
            "right_room_cause_unclear": room_only[key],
        }
    return {
        "healthy_flagged": healthy_flagged,
        "healthy_cases": healthy,
        "wrong_confident": wrong,
        "correct": sum(g["correct"] for g in groups.values()),
        "faulty_cases": sum(g["cases"] for g in groups.values()),
        "groups": groups,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--raw", type=Path, default=RAW_PATH)
    args = parser.parse_args()
    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    if raw["split"] != "training":
        raise SystemExit("the flag rule may only be tuned on TRAINING study cases")
    if raw["template_id"] != load_public_template().template_id:
        raise SystemExit("study was run with a different public template; rerun the study")
    cases = features(raw)
    tune = [c for c in cases if c["house"] % 2 == 0]
    check = [c for c in cases if c["house"] % 2 == 1]
    best = None
    for values in itertools.product(*GRID.values()):
        settings = dict(zip(GRID, values, strict=True))
        result = score(tune, settings)
        if result["healthy_flagged"] or result["wrong_confident"] > MAX_WRONG:
            continue
        nights = [g["median_night"] or 15 for g in result["groups"].values()]
        rank = (result["correct"], -result["wrong_confident"], -sum(nights))
        if best is None or rank > best[0]:
            best = (rank, settings, result)
    if best is None:
        raise SystemExit("no setting met the constraints on the tuning houses")
    _, settings, tuned = best
    checked = score(check, settings)
    report = {
        "rule": (
            "excess heat-loss fraction > a + b/sqrt(nights) for the leading cause; persistence; "
            "cause named if BIC gap > cause_gap"
        ),
        "settings": settings,
        "grid": GRID,
        "constraints": f"tuning houses: no healthy house flagged; at most {MAX_WRONG} wrong confident",
        "tuning_houses": sorted({c["house"] for c in tune}),
        "check_houses": sorted({c["house"] for c in check}),
        "tuning": tuned,
        "check": checked,
        "split": "training season only; held-out winter untouched",
        "template_id": raw["template_id"],
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    write_settings(
        {
            "schema_version": 1,
            "template_id": raw["template_id"],
            "excess_threshold": {
                "draft": {"a": settings["draft_a"], "b": settings["draft_b"]},
                "envelope_conduction": {"a": settings["envelope_a"], "b": settings["envelope_b"]},
            },
            "persistence_nights": settings["persistence"],
            "cause_gap_bic": settings["cause_gap"],
            "public_assets": fingerprints(MONITORING_ASSETS),
            "provenance": (
                "Tuned on TRAINING-season study houses (even house indices) with "
                "backend/simulation/tune_monitoring.py; checked on odd houses. "
                "Not held-out or real-home validation."
            ),
            "check_summary": {
                key: checked[key]
                for key in ("healthy_flagged", "healthy_cases", "wrong_confident", "correct", "faulty_cases")
            },
        },
        DEFAULT_MONITORING_PATH,
    )
    print(json.dumps({"settings": settings, "tuning": tuned, "check": checked}, indent=2))


if __name__ == "__main__":
    main()
