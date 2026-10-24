"""Reproducible real-weather PHYSICS stress sweep, not a diagnosis benchmark.

Run: python -m backend.simulation.qa --output /path/to/physics_qa.json
No source archives, station coordinates, network or missing public engine needed.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from datetime import UTC, timedelta
from pathlib import Path

from backend.app.contracts import FaultType, Series
from backend.data_pipeline import list_weather_nights, load_weather_night

from .observations import fan_protocol, integrate_trajectory, passive_protocol, resample_forcing
from .physics import Fault, build_house, inject_fault, repair_house


def real_forcing(night_id: str) -> tuple[Series, Series]:
    raw = load_weather_night(night_id)
    start = Series.model_validate(raw["outdoor_temperature"]).timestamps[0].astimezone(UTC)
    start = start.replace(hour=22, minute=0, second=0, microsecond=0)
    series = []
    for field in ("outdoor_temperature", "wind_speed"):
        original = Series.model_validate(raw[field])
        indices = [i for i, t in enumerate(original.timestamps) if start <= t <= start + timedelta(hours=8)]
        series.append(
            Series(
                timestamps=[original.timestamps[i] for i in indices],
                values=[original.values[i] for i in indices],
                unit=original.unit,
                provenance=original.provenance,
            )
        )
    return resample_forcing(*series)


def run_sweep() -> dict:
    started = time.perf_counter()
    cases, failures = [], []
    fan_differences = []
    for night in list_weather_nights():
        night_id = night["night_id"]
        temperature, wind = real_forcing(night_id)
        fan = fan_protocol(temperature.timestamps[0])
        for seed in (0, 41):
            healthy = build_house(seed)
            baseline = integrate_trajectory(healthy, temperature, wind, passive_protocol())
            for room_index, room in enumerate(healthy.rooms):
                for kind in (FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION):
                    severity = (0.6, 1.2, 2.0, 3.0)[(room_index + seed) % 4]
                    faulty = inject_fault(healthy, Fault(kind, room.room_id, severity))
                    passive = integrate_trajectory(faulty, temperature, wind, passive_protocol())
                    experiment = integrate_trajectory(faulty, temperature, wind, fan)
                    repaired = repair_house(faulty, healthy, room.room_id, kind, 1)
                    wrong = FaultType.ENVELOPE_CONDUCTION if kind == FaultType.DRAFT else FaultType.DRAFT
                    wrong_repair = repair_house(faulty, healthy, room.room_id, wrong, 1)
                    extra_cooling = baseline[-1][room_index] - passive[-1][room_index]
                    fan_cooling = passive[24][room_index] - experiment[24][room_index]
                    case = {
                        "weather_night_id": night_id,
                        "seed": seed,
                        "room_id": room.room_id,
                        "fault": kind.value,
                        "excess_multiplier": severity,
                        "extra_end_cooling_deg_c": extra_cooling,
                        "fan_extra_cooling_at_2h_deg_c": fan_cooling,
                    }
                    checks = {
                        "fault_adds_cooling": extra_cooling > 0,
                        "fan_adds_cooling": fan_cooling > 0,
                        "correct_repair_restores_baseline": repaired == healthy,
                        "wrong_repair_leaves_fault_unchanged": wrong_repair == faulty,
                        "states_finite": all(math.isfinite(v) for row in experiment for v in row),
                        "passive_thermal_bounds": all(
                            min(temperature.values) - 1e-7
                            <= v
                            <= max(*healthy.initial_air, *healthy.initial_mass) + 1e-7
                            for row in passive
                            for v in row
                        ),
                    }
                    case["checks"] = checks
                    cases.append(case)
                    if not all(checks.values()):
                        failures.append(case)
                    fan_differences.append(fan_cooling)
    return {
        "title": "HH09-inspired truth-simulator physics stress sweep",
        "scope": "Truth physics only; not diagnosis accuracy, fan discriminability or field validation.",
        "weather_nights": len(list_weather_nights()),
        "cases": len(cases),
        "checks": sum(len(c["checks"]) for c in cases),
        "failed_cases": len(failures),
        "duration_seconds": round(time.perf_counter() - started, 3),
        "fan_extra_cooling_at_2h_deg_c_range": [min(fan_differences), max(fan_differences)],
        "failures": failures,
        "case_results": cases,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = run_sweep()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "case_results"}, indent=2))
    if report["failed_cases"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
