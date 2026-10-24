"""Competing public-model predictions for a proposed diagnostic experiment."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from backend.app.contracts import (
    HypothesisFit,
    HypothesisType,
    Protocol,
    PublicTemplate,
    Series,
    WeatherNight,
)

from .model import AUTO, ModelExtension, Multipliers, PublicModelError, PublicNightInputs, simulate_public


def hypothesis_multipliers(room_id: str, fit: HypothesisFit) -> dict[str, Multipliers]:
    """Map a fitted hypothesis onto the multipliers of the candidate room only."""

    fit = HypothesisFit.model_validate(fit.model_dump())
    if fit.fault_type == HypothesisType.NORMAL:
        return {}
    if fit.fault_type == HypothesisType.DRAFT:
        return {room_id: Multipliers(leakage=fit.fitted_multiplier)}
    return {room_id: Multipliers(conduction=fit.fitted_multiplier)}


def predict_experiment(
    template: PublicTemplate,
    room_id: str,
    hypothesis_fits: Sequence[HypothesisFit],
    weather_night: WeatherNight,
    protocol: Protocol,
    initial_temperatures: Mapping[str, float],
    extension: ModelExtension | None = AUTO,
) -> tuple[Series, ...]:
    """Predict the candidate room's trajectory under each competing hypothesis.

    All rooms are forward-simulated together, because future neighbour readings
    do not exist yet. Initial temperatures come from the caller's observed first
    readings, never from simulator state. The returned series follow
    ``weather_night`` timestamps and are labelled ``MODEL_ESTIMATE``.
    """

    if len(hypothesis_fits) < 2:
        raise PublicModelError("at least two competing hypothesis fits are required")
    inputs = PublicNightInputs(weather_night, protocol, dict(initial_temperatures))
    return tuple(
        simulate_public(template, inputs, hypothesis_multipliers(room_id, fit), extension)[room_id]
        for fit in hypothesis_fits
    )
