"""Explicitly synthetic fixtures; not evidence of scientific diagnosis accuracy."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from backend.app.contracts import (
    HypothesisFit,
    HypothesisType,
    Provenance,
    PublicTemplate,
    Series,
    WeatherNight,
)
from backend.data_pipeline import load_hh09_twin_inputs

ROOT = Path(__file__).resolve().parents[3]


def synthetic_weather(
    night_id: str = "synthetic-qa-weather",
    *,
    temperature: float = -2,
    wind: float = 1,
    hours: int = 8,
    start: datetime | None = None,
    split: str = "training",
) -> WeatherNight:
    start = start or datetime(2020, 1, 1, 22, tzinfo=UTC)
    stamps = [start + timedelta(minutes=30 * i) for i in range(hours * 2 + 1)]

    def series(value, unit):
        return Series(
            timestamps=stamps, values=[value] * len(stamps), unit=unit, provenance=Provenance.ASSUMPTION
        )

    return WeatherNight(
        night_id=night_id,
        source={"provider": "HeatHunter tests", "dataset": "Synthetic QA fixture"},
        location={
            "name": "Synthetic test coordinates (not HH09)",
            "latitude": 0,
            "longitude": 0,
            "timezone": "UTC",
        },
        outdoor_temperature=series(temperature, "degC"),
        wind_speed=series(wind, "m/s"),
        train_or_heldout_split=split,
    )


def synthetic_loader(night_id: str) -> WeatherNight:
    date = datetime.strptime(night_id[-10:], "%Y-%m-%d").replace(hour=18, tzinfo=UTC)
    return synthetic_weather(
        night_id, hours=12, start=date, split="heldout" if date.year == 2021 else "training"
    )


def public_template() -> PublicTemplate:
    data = json.loads((ROOT / "shared/fixtures/public_template.json").read_text())
    for room, entry in zip(data["rooms"], load_hh09_twin_inputs()["rooms"], strict=True):
        room["volume_m3"] = entry["geometry"]["volume"]["value"]
        room["room_name"] = entry["display_name"]
    data["template_id"] = "synthetic-QA-only-not-calibrated"
    return PublicTemplate.model_validate(data)


class ScriptedEngine:
    """Control-flow double: deliberately fixed outputs, NOT a numerical fitter."""

    def __init__(self, mode: str = "ambiguous", prediction_gap: float = 1.0):
        self.mode = mode
        self.prediction_gap = prediction_gap
        self.fail = False
        self.calls = []

    def fit_hypothesis(self, nights, room_id, template, cause):
        if self.fail:
            raise RuntimeError("injected engine failure")
        self.calls.append((nights, room_id, template, cause))
        target = room_id == "bedroom_1"
        healthy = self.mode == "healthy" or not target
        rmse = 4.0 if self.mode == "bad" else 0.15
        if healthy:
            bic = 0 if cause == HypothesisType.NORMAL else 5
        elif cause == HypothesisType.NORMAL:
            bic = 100
        elif cause == HypothesisType.DRAFT:
            bic = 0
        else:
            bic = 1 if self.mode == "ambiguous" and len(nights) == 1 else 30
        return HypothesisFit(
            fault_type=cause,
            fitted_multiplier=1 if cause == HypothesisType.NORMAL else 2,
            sse=10,
            bic=bic,
            residual_rmse_deg_c=rmse,
        )

    def predict_experiment(
        self, template, room_id, hypothesis_fits, weather_night, protocol, initial_temperatures
    ):
        stamps = weather_night.outdoor_temperature.timestamps
        return tuple(
            Series(
                timestamps=stamps,
                values=[20 - i * self.prediction_gap] * len(stamps),
                unit="degC",
                provenance=Provenance.MODEL_ESTIMATE,
            )
            for i in range(2)
        )
