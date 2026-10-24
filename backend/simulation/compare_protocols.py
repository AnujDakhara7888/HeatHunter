"""Paired TRAINING-only study of additional passive/calm-fan/windy-fan evidence.

This deliberately evaluates known affected rooms to isolate protocol effects.
It is not detection accuracy, a held-out benchmark, or an ISO-compliant test.
The windy case is an offline research control, never a runtime recommendation.
"""

from __future__ import annotations

import json
from pathlib import Path

from backend.app.contracts import FaultType, HypothesisType, Split
from backend.engine import PublicModelEngine, load_public_template

from .observations import fan_protocol, nighttime_weather, passive_protocol, simulate_night
from .physics import Fault, build_house, inject_fault
from .weather_bridge import load_simulation_weather

OUTPUT_PATH = Path(__file__).with_name("reports") / "paired_protocol_comparison.json"


def run_comparison() -> dict:
    engine, template = PublicModelEngine(), load_public_template()
    w1 = nighttime_weather(load_simulation_weather("smeter-hh09-2019-12-01"))
    w2 = nighttime_weather(load_simulation_weather("smeter-hh09-2020-12-06"))
    windy = nighttime_weather(load_simulation_weather("smeter-hh09-2020-01-28"))
    if any(w.train_or_heldout_split != Split.TRAINING for w in (w1, w2, windy)):
        raise ValueError("paired comparison requires training weather only")
    rows = []
    for seed in (950001, 950002):
        for kind in (FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION):
            for room in ("living_room", "kitchen", "bedroom_1", "bedroom_2"):
                house = inject_fault(build_house(seed), Fault(kind, room, 2))
                passive = simulate_night(house, w1, passive_protocol(), sensor_seed=seed).observations
                control = simulate_night(house, w2, passive_protocol(), sensor_seed=seed).observations
                fan = simulate_night(
                    house, w2, fan_protocol(w2.outdoor_temperature.timestamps[0]), sensor_seed=seed
                ).observations
                windy_fan = simulate_night(
                    house, windy, fan_protocol(windy.outdoor_temperature.timestamps[0]), sensor_seed=seed
                ).observations
                row = {
                    "seed": seed,
                    "truth": kind.value,
                    "room": room,
                    "truth_provenance": "SIMULATED_GROUND_TRUTH",
                }
                for name, nights in (
                    ("passive", [passive]),
                    ("second_passive", [passive, control]),
                    ("calm_fan", [passive, fan]),
                    ("windy_fan", [passive, windy_fan]),
                ):
                    fits = sorted(
                        [
                            engine.fit_hypothesis(nights, room, template, c)
                            for c in (HypothesisType.DRAFT, HypothesisType.ENVELOPE_CONDUCTION)
                        ],
                        key=lambda f: f.bic,
                    )
                    row[name] = {
                        "best": fits[0].fault_type.value,
                        "correct": fits[0].fault_type.value == kind.value,
                        "bic_gap": fits[1].bic - fits[0].bic,
                        "fits": [f.model_dump(mode="json") for f in fits],
                    }
                rows.append(row)
    return {
        "scope": "TRAINING, known affected room, fixed severity 2; not full diagnostic accuracy",
        "cases": len(rows),
        "correct_leading_causes": {
            n: sum(r[n]["correct"] for r in rows)
            for n in ("passive", "second_passive", "calm_fan", "windy_fan")
        },
        "rows": rows,
    }


if __name__ == "__main__":
    result = run_comparison()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "rows"}, indent=2))
