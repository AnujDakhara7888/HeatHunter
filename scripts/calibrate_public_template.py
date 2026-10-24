"""Calibrate and save the HH09 public template from healthy TRAINING simulations.

Run from the repository root:
    .venv/bin/python -m scripts.calibrate_public_template [--houses 40]

The simulator generates only *observations* of healthy houses on the four
TRAINING weather nights (passive), plus healthy fan-test nights on one calm and
one windy TRAINING night. No simulator parameter, seed-to-parameter mapping or
truth record reaches the engine. Calibration house seeds come from a reserved
range that scenario and benchmark seeds must not reuse.
"""

from __future__ import annotations

import argparse
import json
import time

from backend.app.contracts import Split
from backend.data_pipeline import list_weather_nights
from backend.engine import calibrate_public_template, save_calibration
from backend.simulation.observations import (
    fan_protocol,
    nighttime_weather,
    passive_protocol,
    simulate_night,
    sub_seed,
)
from backend.simulation.physics import build_house
from backend.simulation.weather_bridge import load_simulation_weather

CALIBRATION_SEED_BASE = 910_000


def healthy_training_houses(count: int) -> list[list]:
    """Each house: passive runs on all four TRAINING nights + fan runs on one calm and one windy."""

    catalog = list_weather_nights(Split.TRAINING.value)
    weathers = {n["night_id"]: nighttime_weather(load_simulation_weather(n["night_id"])) for n in catalog}
    fan_nights = [
        next(n["night_id"] for n in catalog if n["weather_regime"] == regime) for regime in ("calm", "windy")
    ]
    houses = []
    for h in range(count):
        seed = CALIBRATION_SEED_BASE + h
        house = build_house(sub_seed(seed, "calibration-house") % 2**63)
        sensor_seed = sub_seed(seed, "calibration-sensors") % 2**63
        runs = [(weather, passive_protocol()) for weather in weathers.values()]
        runs += [
            (weathers[night_id], fan_protocol(weathers[night_id].outdoor_temperature.timestamps[0]))
            for night_id in fan_nights
        ]
        houses.append(
            [simulate_night(house, w, protocol, sensor_seed=sensor_seed).observations for w, protocol in runs]
        )
    return houses


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--houses", type=int, default=40)
    args = parser.parse_args()
    started = time.perf_counter()
    houses = healthy_training_houses(args.houses)
    simulated = time.perf_counter()
    result = calibrate_public_template(houses)
    result.report["calibration_seed_range"] = [CALIBRATION_SEED_BASE, CALIBRATION_SEED_BASE + args.houses - 1]
    result.report["runtime_seconds"] = {
        "simulation": round(simulated - started, 1),
        "calibration": round(time.perf_counter() - simulated, 1),
    }
    paths = save_calibration(result)
    print(json.dumps(result.report, indent=2))
    print("Saved " + ", ".join(str(p) for p in paths))


if __name__ == "__main__":
    main()
