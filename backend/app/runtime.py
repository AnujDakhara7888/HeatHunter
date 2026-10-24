"""Wires the owners' service implementations into the API layer.

The API never reimplements science: scenarios, truth, experiments and repairs
come from Mihir's ``HH09ScenarioService``; fits, predictions and money from
Kailash's engine; real-house data from Anuj's reader. This module only chooses
which configured instances to build and keeps the API-side bookkeeping
(diagnosis lookup for money what-ifs, bounded scenario lifetime).
"""

from __future__ import annotations

import json
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .contracts import Assumption, Diagnosis, EvaluationSummary, SourceMetadata

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
POC_REPORT = REPOSITORY_ROOT / "reports" / "poc" / "poc_loop_results.json"
EVALUATION_SUMMARY = REPOSITORY_ROOT / "reports" / "evaluation" / "summary.json"
THRESHOLDS_ENV = "HEATHUNTER_THRESHOLDS_PATH"

# Reproducible guided scenario seed (training split). How it was selected, and
# how often the full workflow occurs across seeds, is disclosed in docs/DEMO.md.
GUIDED_DEMO_SEED = 68

# Keep well below the service's 128-scenario capacity; oldest are discarded.
MAX_LIVE_SCENARIOS = 96


class ThresholdsUnavailableError(RuntimeError):
    """No calibrated diagnostic thresholds exist; diagnosis must not run."""


@dataclass(frozen=True)
class ThresholdConfig:
    detection_bic: float
    ambiguity_bic: float
    adequacy_rmse: float
    separation: float
    measurement_noise: float
    note: str
    source_path: str


def load_threshold_config(path: Path | None = None) -> ThresholdConfig:
    """Thresholds from an explicit file (env override) or the provisional Gate-2 PoC report.

    Mihir owns final threshold tuning. Until he publishes final values, the API
    uses the provisional TRAINING-split PoC values and says so in every diagnosis.
    """

    override = os.environ.get(THRESHOLDS_ENV)
    path = path or (Path(override) if override else POC_REPORT)
    if not path.exists():
        raise ThresholdsUnavailableError(f"diagnostic thresholds not found at {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    raw = payload.get("summary", {}).get("thresholds", payload)
    try:
        return ThresholdConfig(
            detection_bic=float(raw["detection_bic"]),
            ambiguity_bic=float(raw.get("ambiguity_bic", raw.get("ambiguity_bic (provisional)"))),
            adequacy_rmse=float(raw.get("adequacy_rmse", raw.get("adequacy_rmse_deg_c"))),
            separation=float(raw["separation"]),
            measurement_noise=float(raw.get("measurement_noise", raw.get("measurement_noise_deg_c"))),
            note=str(raw.get("note", raw.get("calibration_note", "Threshold source note missing"))),
            source_path=str(
                path.relative_to(REPOSITORY_ROOT) if path.is_relative_to(REPOSITORY_ROOT) else path
            ),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ThresholdsUnavailableError(f"diagnostic thresholds at {path} are malformed: {exc}") from exc


def threshold_assumptions(config: ThresholdConfig) -> list[Assumption]:
    source = SourceMetadata(
        provider="HeatHunter Gate-2 proof of concept (TRAINING split)",
        dataset=config.source_path,
        notes=config.note,
    )
    return [
        Assumption(name="threshold_detection_bic", value=config.detection_bic, unit="BIC", source=source),
        Assumption(name="threshold_ambiguity_bic", value=config.ambiguity_bic, unit="BIC", source=source),
        Assumption(name="threshold_adequacy_rmse", value=config.adequacy_rmse, unit="degC", source=source),
        Assumption(
            name="threshold_separation", value=config.separation, unit="noise-normalized RMS", source=source
        ),
        Assumption(name="measurement_noise", value=config.measurement_noise, unit="degC", source=source),
    ]


class Runtime:
    """Process-wide service instances plus API bookkeeping."""

    def __init__(self) -> None:
        from backend.diagnosis import DiagnosisController, Thresholds
        from backend.engine import PublicModelEngine, PublicMoneyEstimator, load_public_template
        from backend.simulation import HH09ScenarioService

        self.template = load_public_template()
        self.thresholds = load_threshold_config()
        controller = DiagnosisController(
            PublicModelEngine(),
            self.template,
            Thresholds(
                detection_bic=self.thresholds.detection_bic,
                ambiguity_bic=self.thresholds.ambiguity_bic,
                adequacy_rmse=self.thresholds.adequacy_rmse,
                separation=self.thresholds.separation,
                measurement_noise=self.thresholds.measurement_noise,
                calibration_note=self.thresholds.note,
            ),
        )
        self.scenarios = HH09ScenarioService(
            controller, financial_estimator=PublicMoneyEstimator(self.template)
        )
        self._threshold_assumptions = threshold_assumptions(self.thresholds)
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

        names = {a.name for a in diagnosis.assumptions}
        extra = [a for a in self._threshold_assumptions if a.name not in names]
        diagnosis = diagnosis.model_copy(update={"assumptions": [*diagnosis.assumptions, *extra]})
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
