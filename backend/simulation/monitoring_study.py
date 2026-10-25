"""How many consecutive nights does the public engine need? (TRAINING season only.)

Run from the repository root:
    .venv/bin/python -m backend.simulation.monitoring_study [--houses 3] [--nights 14] [--workers 8]

Each case is one simulated HH09-twin house (healthy, draft or envelope fault)
observed for consecutive heating-off nights (22:00-06:00) from a random start
date in the TRAINING winter. The heating is assumed to restore the house to
its daytime state every evening, so each night starts from the house's own
initial condition. Sensor offsets are fixed per house; noise is new each night.

After every night, all three hypotheses are fitted for every room on all nights
so far. The raw per-night scores are saved, so decision rules can be tuned
from them without rerunning. No truth reaches the engine: the hidden fault is
stored only next to the scores, for scoring afterwards.

House seeds come from a reserved range that calibration, scenario and
benchmark seeds must not reuse.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from backend.app.contracts import FaultType, HypothesisType, Split
from backend.data_pipeline.weather_timeline import night_dates, timeline_night
from backend.engine import fit_hypothesis_detailed, load_public_template
from backend.simulation.observations import nighttime_weather, passive_protocol, simulate_night, sub_seed
from backend.simulation.physics import Fault, build_house, inject_fault

STUDY_SEED_BASE = 930_000
ROOMS = ("living_room", "kitchen", "bedroom_1", "bedroom_2")
SEVERITIES = (0.6, 1.2, 2.0)  # excess multipliers: 1.6x, 2.2x, 3x
REPORT_PATH = Path(__file__).resolve().parents[2] / "reports" / "monitoring" / "nights_needed_raw.json"


def cases(houses: int) -> list[dict]:
    out = []
    for h in range(houses):
        for fault_type in (FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION):
            for room in ROOMS:
                for severity in SEVERITIES:
                    out.append(
                        {"house": h, "fault_type": fault_type.value, "room": room, "severity": severity}
                    )
        # As many healthy cases per house as faulty ones per fault type, to measure false alarms.
        out += [
            {"house": h, "fault_type": "none", "room": None, "severity": 0.0, "replica": r} for r in range(8)
        ]
    for index, case in enumerate(out):
        case["seed"] = STUDY_SEED_BASE + index
    return out


def case_observations(case: dict, nights: int) -> tuple[list, list]:
    """Simulated public observations for one study case: (night dates, NightObservations)."""

    seed = case["seed"]
    rng = random.Random(sub_seed(seed, "study-start"))
    dates = night_dates(Split.TRAINING.value)
    start = rng.randrange(len(dates) - nights + 1)
    window = dates[start : start + nights]
    fault = (
        Fault(FaultType.NONE)
        if case["fault_type"] == "none"
        else Fault(FaultType(case["fault_type"]), case["room"], case["severity"])
    )
    house = inject_fault(build_house(sub_seed(seed, "study-house") % 2**63), fault)
    sensor_seed = sub_seed(seed, "study-sensors") % 2**63
    observed = [
        simulate_night(
            house,
            nighttime_weather(timeline_night(Split.TRAINING.value, night_date)),
            passive_protocol(),
            sensor_seed=sensor_seed,
        ).observations
        for night_date in window
    ]
    return window, observed


def run_case(case: dict, nights: int) -> dict:
    window, all_nights = case_observations(case, nights)
    template = load_public_template()
    per_night = []
    for k, night in enumerate(all_nights, start=1):
        observed = all_nights[:k]
        weather = night.weather
        rooms = {}
        for room in ROOMS:
            fits = {
                cause.value: fit_hypothesis_detailed(observed, room, template, cause)
                for cause in (HypothesisType.NORMAL, HypothesisType.DRAFT, HypothesisType.ENVELOPE_CONDUCTION)
            }
            rooms[room] = {
                cause: {
                    "bic": r.fit.bic,
                    "multiplier": r.fit.fitted_multiplier,
                    "rmse": r.fit.residual_rmse_deg_c,
                    "n": r.n_observations,
                }
                for cause, r in fits.items()
            }
        per_night.append(
            {
                "night_id": weather.night_id,
                "mean_wind_m_s": weather.selection_metadata.mean_wind_speed_m_s,
                "mean_outdoor_c": weather.selection_metadata.mean_temperature_deg_c,
                "rooms": rooms,
            }
        )
    return {**case, "start_night": window[0].isoformat(), "nights": per_night}


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--houses", type=int, default=3)
    parser.add_argument("--nights", type=int, default=14)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--output", type=Path, default=REPORT_PATH)
    args = parser.parse_args()
    todo = cases(args.houses)
    started = time.perf_counter()
    with ProcessPoolExecutor(args.workers) as pool:
        results = list(pool.map(run_case, todo, [args.nights] * len(todo)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                "split": Split.TRAINING.value,
                "template_id": load_public_template().template_id,
                "nights_per_case": args.nights,
                "seed_base": STUDY_SEED_BASE,
                "runtime_seconds": round(time.perf_counter() - started, 1),
                "cases": results,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{len(results)} cases in {time.perf_counter() - started:.0f} s -> {args.output}")


if __name__ == "__main__":
    main()
