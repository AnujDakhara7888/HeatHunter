"""Public physics engine (Kailash): RC model, hypothesis fits, calibration, money.

Imports public contracts and Anuj's public twin geometry only. It never imports
the truth simulator or its private store.
"""

from .adapter import PublicModelEngine
from .calibration import (
    CalibrationResult,
    calibrate_public_template,
    load_public_template,
    save_calibration,
)
from .fitting import FitResult, FitSettings, fit_hypothesis, fit_hypothesis_detailed
from .model import (
    AUTO,
    LeakageLaw,
    ModelExtension,
    Multipliers,
    PublicModelError,
    PublicNightInputs,
    load_model_extension,
    simulate_public,
)
from .money import MoneyOverrides, PublicMoneyEstimator, estimate_money, remeasured_savings_kwh
from .prediction import predict_experiment

__all__ = [
    "AUTO",
    "LeakageLaw",
    "ModelExtension",
    "CalibrationResult",
    "FitResult",
    "FitSettings",
    "MoneyOverrides",
    "Multipliers",
    "PublicModelEngine",
    "PublicModelError",
    "PublicMoneyEstimator",
    "PublicNightInputs",
    "calibrate_public_template",
    "estimate_money",
    "fit_hypothesis",
    "fit_hypothesis_detailed",
    "load_model_extension",
    "load_public_template",
    "predict_experiment",
    "remeasured_savings_kwh",
    "save_calibration",
    "simulate_public",
]
