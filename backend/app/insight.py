"""Fitted-curve explanations for the UI (Nikhil, integration layer).

The diagnosis contract reports each hypothesis as a score. The UI also needs to
*draw* what each hypothesis predicts, so this module re-runs the public engine's
own fit and evaluates its prediction at the fitted parameters. It reads public
observations and the public template only; it never touches simulator truth.
"""

from __future__ import annotations

import time
from datetime import timedelta

import numpy as np

from backend.engine.fitting import (
    FitSettings,
    fit_hypothesis_detailed,
    hypothesis_physics,
    predict_room_air,
    prepare_room_night,
)
from backend.engine.model import AUTO, Forcing, ModelExtension, TemplateArrays, resolve_extension
from backend.engine.prediction import predict_experiment

from .contracts import (
    FitCurve,
    HypothesisType,
    NightObservations,
    Provenance,
    PublicTemplate,
    RoomInsight,
    Series,
)


def _predicted_series(
    nights: list[NightObservations],
    template: PublicTemplate,
    room_id: str,
    cause: HypothesisType,
    detail,
    settings: FitSettings,
    extension: ModelExtension | None,
) -> dict[str, Series]:
    arrays = TemplateArrays.from_template(template, extension)
    i = arrays.index(room_id)
    m = detail.fit.fitted_multiplier
    room, neighbours = hypothesis_physics(
        arrays,
        i,
        m if cause == HypothesisType.ENVELOPE_CONDUCTION else 1.0,
        m if cause == HypothesisType.DRAFT else 1.0,
    )
    out: dict[str, Series] = {}
    for night in nights:
        block = prepare_room_night(night, arrays, i, settings)
        values = predict_room_air(
            block,
            room,
            neighbours,
            detail.initial_temperatures_deg_c[night.night_id],
            detail.sensor_offset_deg_c,
        )
        forcing = Forcing.from_weather(night.weather, night.protocol)
        eligible = forcing.seconds[forcing.seconds >= settings.transient_skip_seconds - 1e-9]
        grid = forcing.integration_grid(float(eligible[0]))
        start = forcing.timestamps[0]
        out[night.night_id] = Series(
            timestamps=[start + timedelta(seconds=float(grid[k])) for k in block.obs_index],
            values=[round(float(v), 4) for v in values],
            unit="degC",
            provenance=Provenance.MODEL_ESTIMATE,
        )
    return out


def room_insights(
    nights: list[NightObservations],
    template: PublicTemplate,
    room_ids: list[str] | None = None,
    *,
    extension: ModelExtension | None | object = AUTO,
    settings: FitSettings | None = None,
) -> tuple[list[RoomInsight], int, float]:
    """Fit all three hypotheses per room and return their predicted curves."""

    started = time.perf_counter()
    settings = settings or FitSettings()
    layer = resolve_extension(template, extension)
    ids = room_ids or [room.room_id for room in template.rooms]
    insights: list[RoomInsight] = []
    evaluations = 0
    for room_id in ids:
        fits: list[FitCurve] = []
        for cause in HypothesisType:
            detail = fit_hypothesis_detailed(nights, room_id, template, cause, settings, layer)
            evaluations += 1
            fits.append(
                FitCurve(
                    fault_type=cause,
                    fitted_multiplier=detail.fit.fitted_multiplier,
                    bic=detail.fit.bic,
                    residual_rmse_deg_c=detail.fit.residual_rmse_deg_c,
                    sensor_offset_deg_c=detail.sensor_offset_deg_c,
                    converged=detail.converged,
                    predicted=_predicted_series(nights, template, room_id, cause, detail, settings, layer),
                    warnings=list(detail.warnings),
                )
            )
        normal = next(f for f in fits if f.fault_type == HypothesisType.NORMAL)
        best_fault = min(f.bic for f in fits if f.fault_type != HypothesisType.NORMAL)
        insights.append(RoomInsight(room_id=room_id, fits=fits, anomaly_score=normal.bic - best_fault))
    return insights, evaluations, (time.perf_counter() - started) * 1000


def predict_night(
    template: PublicTemplate,
    room_id: str,
    causes,
    night: NightObservations,
    *,
    extension: ModelExtension | None | object = AUTO,
) -> dict[str, Series]:
    """Forward-predict a night under each competing hypothesis, from its first readings."""

    initial = {}
    for rid, series in night.room_temperature_series.items():
        first = next((v for v in series.values if v is not None and np.isfinite(v)), None)
        if first is None:
            raise ValueError(f"room {rid} has no readings to initialize the prediction")
        initial[rid] = float(first)
    predictions = predict_experiment(
        template,
        room_id,
        list(causes),
        night.weather,
        night.protocol,
        initial,
        resolve_extension(template, extension),
    )
    return {fit.fault_type.value: series for fit, series in zip(causes, predictions, strict=False)}
