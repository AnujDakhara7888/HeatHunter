"""Fitted curves for the UI: what a fitted hypothesis predicts each night.

Used for the "expected if healthy" line in API v2 readings. It evaluates the
public engine's own prediction at a fit's parameters, from public observations
and the public template only; it never touches simulator truth.
"""

from __future__ import annotations

from datetime import timedelta

from backend.engine.fitting import (
    FitSettings,
    hypothesis_physics,
    predict_room_air,
    prepare_room_night,
)
from backend.engine.model import Forcing, ModelExtension, TemplateArrays

from .contracts import (
    HypothesisType,
    NightObservations,
    Provenance,
    PublicTemplate,
    Series,
)


def predicted_series(
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
