"""Adapter implementing the diagnosis controller's ``PublicEngine`` protocol.

``backend.diagnosis.DiagnosisController`` (Mihir) calls these two methods. The
adapter forwards to the public model only, never to simulator state. The
calibrated model extension is selected by the template's ``template_id``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from backend.app.contracts import (
    HypothesisFit,
    HypothesisType,
    NightObservations,
    Protocol,
    PublicTemplate,
    Series,
    WeatherNight,
)

from .fitting import FitSettings, fit_hypothesis
from .model import AUTO, ModelExtension, resolve_extension
from .prediction import predict_experiment


class PublicModelEngine:
    def __init__(self, settings: FitSettings | None = None, extension: ModelExtension | None = AUTO) -> None:
        self.settings = settings or FitSettings()
        self._extension = extension

    def _layer(self, template: PublicTemplate) -> ModelExtension | None:
        return resolve_extension(template, self._extension)

    def fit_hypothesis(
        self,
        nights: list[NightObservations],
        room_id: str,
        template: PublicTemplate,
        cause: HypothesisType,
    ) -> HypothesisFit:
        return fit_hypothesis(nights, room_id, template, cause, self.settings, self._layer(template))

    def predict_experiment(
        self,
        template: PublicTemplate,
        room_id: str,
        hypothesis_fits: Sequence[HypothesisFit],
        weather_night: WeatherNight,
        protocol: Protocol,
        initial_temperatures: Mapping[str, float],
    ) -> tuple[Series, Series]:
        first, second = predict_experiment(
            template,
            room_id,
            tuple(hypothesis_fits)[:2],
            weather_night,
            protocol,
            initial_temperatures,
            self._layer(template),
        )
        return first, second
