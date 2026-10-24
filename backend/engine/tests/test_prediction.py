from __future__ import annotations

import pytest

from backend.app.contracts import HypothesisFit, HypothesisType, Provenance
from backend.diagnosis.controller import separation_score
from backend.engine import PublicModelEngine, predict_experiment
from backend.engine.model import PublicModelError
from backend.engine.tests.helpers import fan, passive, synthetic_weather, two_room_template


def fit(cause: HypothesisType, multiplier: float) -> HypothesisFit:
    return HypothesisFit(
        fault_type=cause, fitted_multiplier=multiplier, sse=1.0, bic=0.0, residual_rmse_deg_c=0.1
    )


COMPETING = (fit(HypothesisType.DRAFT, 3.0), fit(HypothesisType.ENVELOPE_CONDUCTION, 1.4))
INITIAL = {"a": 20.0, "b": 19.5}


def test_predictions_are_model_estimates_on_experiment_timestamps():
    weather = synthetic_weather("experiment")
    draft, conduction = predict_experiment(
        two_room_template(), "a", COMPETING, weather, fan(weather), INITIAL
    )
    for series in (draft, conduction):
        assert series.provenance == Provenance.MODEL_ESTIMATE
        assert series.timestamps == weather.outdoor_temperature.timestamps
        assert series.values[0] == pytest.approx(20.0)


def test_fan_separates_draft_from_conduction_more_than_passive_night():
    weather = synthetic_weather("experiment", outdoor=2.0, wind=1.0)
    stamps = weather.outdoor_temperature.timestamps
    with_fan = predict_experiment(two_room_template(), "a", COMPETING, weather, fan(weather), INITIAL)
    without = predict_experiment(two_room_template(), "a", COMPETING, weather, passive(), INITIAL)
    assert separation_score(with_fan, stamps, 0.15) > separation_score(without, stamps, 0.15)


def test_adapter_returns_exactly_two_series_for_the_controller():
    weather = synthetic_weather("experiment")
    result = PublicModelEngine().predict_experiment(
        two_room_template(), "a", COMPETING, weather, fan(weather), INITIAL
    )
    assert len(result) == 2


def test_requires_two_hypotheses():
    weather = synthetic_weather()
    with pytest.raises(PublicModelError, match="two competing"):
        predict_experiment(two_room_template(), "a", COMPETING[:1], weather, fan(weather), INITIAL)
