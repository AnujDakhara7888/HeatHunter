from __future__ import annotations

import ast
from pathlib import Path

import pytest

from backend.app.contracts import HypothesisType, Provenance
from backend.diagnosis.controller import (
    DiagnosisController,
    Thresholds,
    calibrate_healthy_thresholds,
)
from backend.simulation.observations import fan_protocol, passive_protocol, resample_weather, simulate_night
from backend.simulation.physics import build_house
from backend.simulation.tests.helpers import ScriptedEngine, public_template, synthetic_weather


def analyze(mode="ambiguous", gap=1.0, mutate=None):
    weather = synthetic_weather(hours=2)
    observation = simulate_night(build_house(1), weather, passive_protocol(), sensor_seed=1).observations
    if mutate:
        mutate(observation)
    controller = DiagnosisController(ScriptedEngine(mode, gap), public_template(), Thresholds(10, 5, 0.5))
    return controller.analyze(
        [observation],
        next_weather=resample_weather(weather),
        next_protocol=fan_protocol(weather.outdoor_temperature.timestamps[0]),
    )


@pytest.mark.parametrize(
    "mode,expected",
    [
        ("healthy", "no_fault"),
        ("ambiguous", "ambiguous"),
        ("confident", "confident"),
        ("bad", "unexplained"),
    ],
)
def test_status_decisions_from_public_fit_results(mode, expected):
    result = analyze(mode)
    assert result.status == expected
    if expected in {"no_fault", "unexplained"}:
        assert result.flagged_room_id is None
    else:
        assert result.flagged_room_id == "bedroom_1"


def test_test_is_not_automatically_recommended():
    assert analyze(gap=1).test_decision.recommended
    assert not analyze(gap=0.01).test_decision.recommended
    assert not analyze("confident").test_decision.recommended
    assert analyze("healthy").test_decision is None


def test_all_missing_observations_are_unexplained():
    def missing(night):
        for s in night.room_temperature_series.values():
            s.values = [None] * len(s.values)

    assert analyze(mutate=missing).status == "unexplained"


def test_nonfinite_observation_rejected():
    def mutate(night):
        night.room_temperature_series["kitchen"].values[2] = float("nan")

    with pytest.raises(ValueError, match="non-finite"):
        analyze(mutate=mutate)


def test_real_indoor_data_cannot_be_substituted_for_simulated_measurements():
    def mutate(night):
        night.room_temperature_series["kitchen"].provenance = Provenance.REAL_MEASUREMENT

    with pytest.raises(ValueError, match="synthetic"):
        analyze(mutate=mutate)


def test_nonfinite_and_mismatched_engine_outputs_rejected():
    class Broken(ScriptedEngine):
        def fit_hypothesis(self, *args):
            result = super().fit_hypothesis(*args)
            result.bic = float("nan")
            return result

    observation = simulate_night(
        build_house(1), synthetic_weather(hours=1), passive_protocol(), sensor_seed=1
    ).observations
    controller = DiagnosisController(Broken(), public_template(), Thresholds(10, 5, 0.5))
    with pytest.raises(ValueError, match="non-finite"):
        controller.analyze([observation])


def test_future_predictions_cannot_read_future_room_observations():
    class Spy(ScriptedEngine):
        def predict_experiment(
            self, template, room_id, hypothesis_fits, weather_night, protocol, initial_temperatures
        ):
            assert set(initial_temperatures) == {r.room_id for r in template.rooms}
            assert not hasattr(weather_night, "room_temperature_series")
            assert all(isinstance(v, float) for v in initial_temperatures.values())
            return super().predict_experiment(
                template, room_id, hypothesis_fits, weather_night, protocol, initial_temperatures
            )

    weather = synthetic_weather(hours=2)
    observation = simulate_night(build_house(1), weather, passive_protocol(), sensor_seed=1).observations
    result = DiagnosisController(Spy(), public_template(), Thresholds(10, 5, 0.5)).analyze(
        [observation],
        next_weather=resample_weather(weather),
        next_protocol=fan_protocol(weather.outdoor_temperature.timestamps[0]),
    )
    assert result.test_decision.recommended


def test_bad_predictions_rejected():
    class Broken(ScriptedEngine):
        def predict_experiment(self, *args):
            a, b = super().predict_experiment(*args)
            a.values[2] = None
            return a, b

    weather = synthetic_weather(hours=2)
    obs = simulate_night(build_house(1), weather, passive_protocol(), sensor_seed=1).observations
    with pytest.raises(ValueError, match="complete"):
        DiagnosisController(Broken(), public_template(), Thresholds(10, 5, 0.5)).analyze(
            [obs],
            next_weather=resample_weather(weather),
            next_protocol=fan_protocol(weather.outdoor_temperature.timestamps[0]),
        )


def test_heldout_weather_rejected_for_threshold_calibration():
    obs = simulate_night(
        build_house(1), synthetic_weather(hours=1, split="heldout"), passive_protocol(), sensor_seed=1
    ).observations
    with pytest.raises(ValueError, match="training"):
        calibrate_healthy_thresholds(ScriptedEngine(), public_template(), [[obs]] * 20, ambiguity_bic=5)


def test_diagnosis_has_no_private_simulation_imports_or_dynamic_import_escape():
    for path in Path("backend/diagnosis").glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert "simulation" not in (node.module or "")
            if isinstance(node, ast.Import):
                assert not any("simulation" in n.name for n in node.names)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in {"__import__", "eval", "exec"}


def test_equal_scores_remain_ambiguous_and_no_probability_is_claimed():
    class Tied(ScriptedEngine):
        def fit_hypothesis(self, *args):
            fit = super().fit_hypothesis(*args)
            if args[-1] == HypothesisType.ENVELOPE_CONDUCTION and args[1] == "bedroom_1":
                fit.bic = 0
            return fit

    obs = simulate_night(
        build_house(1), synthetic_weather(hours=1), passive_protocol(), sensor_seed=1
    ).observations
    result = DiagnosisController(Tied(), public_template(), Thresholds(10, 5, 0.5)).analyze([obs])
    assert result.status == "ambiguous"
    assert result.money_estimate is None
    assert "probabilities" in " ".join(result.uncertainty)


def test_missing_initial_reading_does_not_substitute_a_later_temperature():
    def mutate(night):
        night.room_temperature_series["kitchen"].values[0] = None

    result = analyze(mutate=mutate)
    assert result.status == "ambiguous"
    assert not result.test_decision.recommended
    assert "Initial" in result.test_decision.explanation


def test_nonfinite_public_template_and_dangling_couplings_rejected():
    template = public_template()
    template.rooms[0].nominal_capacitance_j_per_k = float("inf")
    with pytest.raises(ValueError, match="non-finite"):
        DiagnosisController(ScriptedEngine(), template, Thresholds(10, 5, 0.5))
    template = public_template()
    template.inter_room_couplings[0].room_a_id = "not-a-room"
    with pytest.raises(ValueError, match="coupling"):
        DiagnosisController(ScriptedEngine(), template, Thresholds(10, 5, 0.5))
