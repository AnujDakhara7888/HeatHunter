"""Sourced engine assumptions from ``config/assumptions.json``.

The file is the single home of tunable physical and economic defaults. Values
flagged ``verified: false`` are illustrative and must be user-adjustable.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from backend.app.contracts import Assumption, SourceMetadata

DEFAULT_ASSUMPTIONS_PATH = Path(__file__).resolve().parents[2] / "config" / "assumptions.json"


class AssumptionError(ValueError):
    """Raised when the assumptions file is missing a required, well-formed entry."""


def load_assumptions(path: str | Path | None = None) -> dict[str, Any]:
    """Load the assumptions file; the default path is cached because it is read-only."""

    if path is None:
        return _load_default()
    return _read(Path(path))


@lru_cache(maxsize=1)
def _load_default() -> dict[str, Any]:
    return _read(DEFAULT_ASSUMPTIONS_PATH)


def _read(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"Assumptions file is missing: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1:
        raise AssumptionError("Unsupported assumptions schema version")
    for section in ("physical", "economic"):
        if not isinstance(payload.get(section), dict):
            raise AssumptionError(f"Assumptions file lacks the {section} section")
    return payload


def entry(config: dict[str, Any], section: str, name: str) -> dict[str, Any]:
    try:
        item = config[section][name]
    except KeyError:
        raise AssumptionError(f"Missing assumption {section}.{name}") from None
    if "source" not in item:
        raise AssumptionError(f"Assumption {section}.{name} has no source metadata")
    return item


def value(config: dict[str, Any], section: str, name: str) -> float:
    number = entry(config, section, name).get("value")
    if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
        raise AssumptionError(f"Assumption {section}.{name} must have a finite numeric value")
    return float(number)


def to_contract(name: str, item: dict[str, Any], *, value_override: float | None = None) -> Assumption:
    """Convert an assumptions entry into the canonical ``Assumption`` contract model."""

    source = dict(item["source"])
    if not item.get("verified", False):
        source["notes"] = "UNVERIFIED illustrative default; user-adjustable. " + (source.get("notes") or "")
    return Assumption(
        name=name,
        value=item["value"] if value_override is None else value_override,
        unit=item.get("unit"),
        source=SourceMetadata(**source),
    )


def wind_sensitivity(config: dict[str, Any] | None = None) -> float:
    """Linear wind sensitivity beta (s/m) from the ASHRAE/LBL wind-stack relation.

    Infiltration scales as sqrt(Cs dT + Cw w^2). Dividing by the calm value gives
    g(w) = sqrt(1 + (Cw/Cs) w^2 / dT_ref). A least-squares line a + b w fitted to
    g over the configured wind range gives beta = b / a, the slope of the public
    model's ``1 + beta w`` form relative to its calm intercept.
    """

    config = config or load_assumptions()
    model = entry(config, "physical", "infiltration_wind_stack_model")
    ratio = float(model["wind_coefficient"]) / float(model["stack_coefficient"])
    delta_t = float(model["reference_delta_t_k"])
    low, high = (float(bound) for bound in model["wind_fit_range_m_s"])
    if ratio <= 0 or delta_t <= 0 or high <= low or low < 0:
        raise AssumptionError("Invalid infiltration wind-stack model configuration")
    wind = np.linspace(low, high, 161)
    response = np.sqrt(1.0 + ratio * wind**2 / delta_t)
    slope, intercept = np.polyfit(wind, response, 1)
    return float(slope / intercept)


def stack_wind_ratio(config: dict[str, Any] | None = None) -> tuple[float, float]:
    """ASHRAE/LBL Cw/Cs ratio (K s^2/m^2) and the reference indoor-outdoor difference (K)."""

    config = config or load_assumptions()
    model = entry(config, "physical", "infiltration_wind_stack_model")
    ratio = float(model["wind_coefficient"]) / float(model["stack_coefficient"])
    delta_t = float(model["reference_delta_t_k"])
    if not (math.isfinite(ratio) and ratio > 0 and math.isfinite(delta_t) and delta_t > 0):
        raise AssumptionError("Invalid infiltration wind-stack model configuration")
    return ratio, delta_t
