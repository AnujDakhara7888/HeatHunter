"""Wires the owners' service implementations into the API layer.

The API never reimplements science: scenarios, truth, experiments and repairs
come from Mihir's ``HH09ScenarioService``; fits, predictions and money from
Kailash's engine; real-house data from Anuj's reader. This module only chooses
which configured instances to build and keeps the API-side bookkeeping
(diagnosis lookup for money what-ifs, bounded scenario lifetime).
"""

from __future__ import annotations

import os
import threading
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path

from backend.diagnosis import Thresholds
from backend.diagnosis.settings import DecisionSettingsError
from backend.simulation.runtime import build_runtime_components

from .contracts import Assumption, Diagnosis, EvaluationSummary, SourceMetadata

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EVALUATION_SUMMARY = REPOSITORY_ROOT / "reports" / "evaluation" / "summary.json"
THRESHOLDS_ENV = "HEATHUNTER_THRESHOLDS_PATH"

# Keep well below the service's 128-scenario capacity; oldest are discarded.
MAX_LIVE_SCENARIOS = 96


class ThresholdsUnavailableError(RuntimeError):
    """No calibrated diagnostic thresholds exist; diagnosis must not run."""


def threshold_assumptions(
    config: Thresholds, *, phase: str, settings_path: Path, max_wind_m_s: float
) -> list[Assumption]:
    source = SourceMetadata(
        provider="HeatHunter conservative calibration (TRAINING split)",
        dataset=str(
            settings_path.relative_to(REPOSITORY_ROOT)
            if settings_path.is_relative_to(REPOSITORY_ROOT)
            else settings_path
        ),
        notes=f"{config.calibration_note} Decision phase: {phase}. Not held-out or real-home validation.",
    )
    return [
        Assumption(name="threshold_detection_bic", value=config.detection_bic, unit="BIC", source=source),
        Assumption(name="threshold_ambiguity_bic", value=config.ambiguity_bic, unit="BIC", source=source),
        Assumption(name="threshold_adequacy_rmse", value=config.adequacy_rmse, unit="degC", source=source),
        Assumption(
            name="threshold_separation", value=config.separation, unit="noise-normalized RMS", source=source
        ),
        Assumption(name="measurement_noise", value=config.measurement_noise, unit="degC", source=source),
        Assumption(name="confidence_enabled", value=config.confidence_enabled, source=source),
        Assumption(name="fan_max_wind_speed", value=max_wind_m_s, unit="m/s", source=source),
    ]


class Runtime:
    """Process-wide service instances plus API bookkeeping."""

    def __init__(self) -> None:
        try:
            components = build_runtime_components(settings_path=os.environ.get(THRESHOLDS_ENV))
        except (DecisionSettingsError, OSError) as exc:
            raise ThresholdsUnavailableError(f"validated decision configuration unavailable: {exc}") from exc
        self.template = components.template.model_copy(deep=True)
        self.scenarios = components.scenarios
        self.thresholds = components.profiles
        self._settings_path = components.settings_path
        self._max_wind_m_s = components.fan_policy.max_wind_m_s
        self._lock = threading.Lock()
        self._live: OrderedDict[str, None] = OrderedDict()
        self._diagnoses: dict[str, tuple[str, Diagnosis]] = {}

    def track_scenario(self, scenario_id: str) -> None:
        with self._lock:
            self._live[scenario_id] = None
            while len(self._live) > MAX_LIVE_SCENARIOS:
                stale, _ = self._live.popitem(last=False)
                self.scenarios.discard(stale)
                self._diagnoses = {k: v for k, v in self._diagnoses.items() if v[0] != stale}

    def disclose(self, scenario_id: str, diagnosis: Diagnosis) -> Diagnosis:
        """Attach the thresholds the API configured, and remember the diagnosis for money what-ifs."""

        phase = next((a.value for a in diagnosis.assumptions if a.name == "decision_phase"), None)
        if phase not in {"passive", "post_fan"}:
            raise RuntimeError("diagnosis did not declare a recognized decision phase")
        config = self.thresholds.post_fan if phase == "post_fan" else self.thresholds.passive
        extra = threshold_assumptions(
            config, phase=phase, settings_path=self._settings_path, max_wind_m_s=self._max_wind_m_s
        )
        names = {a.name for a in extra}
        diagnosis = diagnosis.model_copy(
            update={"assumptions": [a for a in diagnosis.assumptions if a.name not in names] + extra}
        )
        with self._lock:
            self._diagnoses[diagnosis.diagnosis_id] = (scenario_id, diagnosis.model_copy(deep=True))
        return diagnosis

    def diagnosis(self, scenario_id: str, diagnosis_id: str) -> Diagnosis:
        with self._lock:
            entry = self._diagnoses.get(diagnosis_id)
        if entry is None or entry[0] != scenario_id:
            raise KeyError("unknown diagnosis for this scenario")
        return entry[1].model_copy(deep=True)


_runtime_lock = threading.Lock()


@lru_cache(maxsize=1)
def _build_runtime() -> Runtime:
    return Runtime()


def get_runtime() -> Runtime:
    with _runtime_lock:
        return _build_runtime()


def reset_runtime() -> None:
    """Testing hook: drop all live scenarios and rebuild on next use."""

    with _runtime_lock:
        _build_runtime.cache_clear()


def load_evaluation_summary(path: Path = EVALUATION_SUMMARY) -> EvaluationSummary | None:
    if not path.exists():
        return None
    return EvaluationSummary.model_validate_json(path.read_text(encoding="utf-8"))
