from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest

from backend.app.contracts import DiagnoseRequest, ExperimentRequest, ScenarioCreateRequest
from backend.diagnosis import DiagnosisController, Thresholds
from backend.simulation import GUIDED_SCENARIO_ID, HH09ScenarioService, ScenarioStateError
from backend.simulation import service as service_module
from backend.simulation.experiment_policy import CalmFanPolicy
from backend.simulation.observations import fan_protocol, resample_weather
from backend.simulation.tests.helpers import (
    ScriptedEngine,
    public_template,
    synthetic_loader,
    synthetic_weather,
)


def test_checks_test_interval_not_whole_night_average():
    weather = synthetic_weather(hours=8)
    protocol = fan_protocol(weather.wind_speed.timestamps[0])
    weather.wind_speed.values[2] = 3
    assert not CalmFanPolicy().assess(weather, protocol)[0]
    weather.wind_speed.values[2] = 1
    weather.wind_speed.values[-1] = 10
    assert CalmFanPolicy().assess(weather, protocol)[0]


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), -1])
def test_missing_or_invalid_interval_wind_is_not_calm(bad):
    weather = synthetic_weather(hours=8)
    weather.wind_speed.values[1] = bad
    assert not CalmFanPolicy().assess(weather, fan_protocol(weather.wind_speed.timestamps[0]))[0]


def test_interpolated_endpoint_cannot_hide_windy_bracketing_sample():
    weather = synthetic_weather(hours=8)
    start = weather.wind_speed.timestamps[0] + timedelta(minutes=15)
    weather.wind_speed.values[0] = 5
    assert not CalmFanPolicy().assess(weather, fan_protocol(start))[0]


def test_boundary_equal_to_limit_is_allowed_and_units_are_checked():
    weather = synthetic_weather(hours=8, wind=2)
    protocol = fan_protocol(weather.wind_speed.timestamps[0])
    assert CalmFanPolicy().assess(weather, protocol)[0]
    weather.wind_speed.unit = "mph"
    assert not CalmFanPolicy().assess(weather, protocol)[0]


def test_default_real_weather_selection_and_explicit_windy_override():
    async def check():
        service = HH09ScenarioService()
        request = ScenarioCreateRequest(mode="guided", guided_scenario_id=GUIDED_SCENARIO_ID)
        await service.create_scenario(request)
        with pytest.raises(ValueError, match="deferred"):
            await service.create_scenario(request, experiment_night_id="smeter-hh09-2020-01-28")
        # Windy PASSIVE conditions remain a supported observation protocol.
        await service.create_scenario(request, weather_night_id="smeter-hh09-2020-01-28")

    asyncio.run(check())


def test_force_for_evaluation_cannot_bypass_runtime_wind_gate(monkeypatch):
    monkeypatch.setattr(service_module, "load_simulation_weather", synthetic_loader)
    service = HH09ScenarioService(
        DiagnosisController(ScriptedEngine(), public_template(), Thresholds(10, 5, 0.5))
    )

    async def check():
        item = await service.create_scenario(
            ScenarioCreateRequest(mode="guided", guided_scenario_id=GUIDED_SCENARIO_ID, seed=2)
        )
        diagnosis = await service.diagnose(item.scenario_id, DiagnoseRequest())
        assert diagnosis.test_decision.recommended

        def wind_changed(night_id):
            weather = synthetic_loader(night_id)
            weather.wind_speed.values = [8.0] * len(weather.wind_speed.values)
            return weather

        monkeypatch.setattr(service_module, "load_simulation_weather", wind_changed)
        with pytest.raises(ScenarioStateError, match="deferred"):
            await service.run_experiment(
                item.scenario_id,
                ExperimentRequest(
                    diagnosis_id=diagnosis.diagnosis_id, experiment_type="exhaust_fan_depressurization"
                ),
                force_for_evaluation=True,
            )
        assert len((await service.get_observations(item.scenario_id)).nights) == 1

    asyncio.run(check())


def test_resampling_does_not_remove_wind_limit_violation():
    weather = synthetic_weather(hours=8)
    weather.wind_speed.values[2] = 3
    interpolated = resample_weather(weather)
    assert not CalmFanPolicy().assess(interpolated, fan_protocol(weather.wind_speed.timestamps[0]))[0]


def test_no_eligible_fan_night_still_allows_passive_investigation(monkeypatch):
    def windy(night_id):
        weather = synthetic_loader(night_id)
        weather.wind_speed.values = [8.0] * len(weather.wind_speed.values)
        return weather

    monkeypatch.setattr(service_module, "load_simulation_weather", windy)
    service = HH09ScenarioService(
        DiagnosisController(ScriptedEngine(), public_template(), Thresholds(10, 5, 0.5))
    )

    async def check():
        item = await service.create_scenario(
            ScenarioCreateRequest(mode="guided", guided_scenario_id=GUIDED_SCENARIO_ID, seed=2)
        )
        result = await service.diagnose(item.scenario_id, DiagnoseRequest())
        assert result.status == "ambiguous" and not result.test_decision.recommended
        assert "No different calm" in result.test_decision.explanation

    asyncio.run(check())
