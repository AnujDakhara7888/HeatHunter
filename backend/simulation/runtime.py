"""One offline factory for Nikhil; preserves existing contracts and routes."""

from __future__ import annotations

from pathlib import Path

from backend.app.contracts import Split
from backend.data_pipeline import list_weather_nights
from backend.diagnosis import DiagnosisController
from backend.diagnosis.settings import DecisionSettingsError, fingerprints, load_settings
from backend.engine import PublicModelEngine, PublicMoneyEstimator, load_public_template

from .experiment_policy import CalmFanPolicy
from .service import HH09ScenarioService

SIMULATOR_ASSETS = (
    "backend/simulation/physics.py",
    "backend/simulation/observations.py",
    "data/processed/hh09_twin_inputs.json",
)
OPERATING_ASSETS = ("backend/simulation/experiment_policy.py",)


def build_scenario_service(
    *, split: Split = Split.TRAINING, settings_path: str | Path | None = None, max_scenarios: int = 128
) -> HH09ScenarioService:
    template = load_public_template()
    profiles, payload = load_settings(settings_path, template_id=template.template_id)
    if payload.get("simulator_assets") != fingerprints(SIMULATOR_ASSETS):
        raise DecisionSettingsError("Twin/simulator changed after calibration; recalibrate decision settings")
    if payload.get("operating_assets") != fingerprints(OPERATING_ASSETS):
        raise DecisionSettingsError("Fan operating policy changed; review/recalibrate decision settings")
    training_weather_assets = tuple(
        f"data/weather/hh09/{n['night_id']}.json" for n in list_weather_nights(Split.TRAINING.value)
    )
    if payload.get("weather_assets") != fingerprints(training_weather_assets):
        raise DecisionSettingsError(
            "Training weather changed after calibration; recalibrate decision settings"
        )
    policy = CalmFanPolicy(**payload["fan_policy"])
    controller = DiagnosisController(PublicModelEngine(), template, profiles)
    return HH09ScenarioService(
        controller,
        financial_estimator=PublicMoneyEstimator(template),
        split=split,
        fan_policy=policy,
        max_scenarios=max_scenarios,
    )
