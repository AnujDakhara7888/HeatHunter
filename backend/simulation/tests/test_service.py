from __future__ import annotations

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.app.contracts import (
    DiagnoseRequest,
    ExperimentRequest,
    FaultType,
    RepairRequest,
    ScenarioCreateRequest,
    Split,
)
from backend.diagnosis import DiagnosisController, EngineDependencyError, Thresholds
from backend.simulation import GUIDED_SCENARIO_ID, HH09ScenarioService, ScenarioStateError
from backend.simulation import service as service_module
from backend.simulation.tests.helpers import ScriptedEngine, public_template, synthetic_loader
from backend.simulation.weather_bridge import WeatherContractError, load_simulation_weather


def run(awaitable):
    return asyncio.run(awaitable)


@pytest.fixture
def setup_service(monkeypatch):
    # Only state/orchestration tests use a synthetic weather loader; no claim of HH09 data QA here.
    monkeypatch.setattr(service_module, "load_simulation_weather", synthetic_loader)
    engine = ScriptedEngine()
    service = HH09ScenarioService(DiagnosisController(engine, public_template(), Thresholds(10, 5, 0.5)))
    return service, engine


def create(service, **kwargs):
    return run(
        service.create_scenario(
            ScenarioCreateRequest(mode="guided", guided_scenario_id=GUIDED_SCENARIO_ID, seed=2), **kwargs
        )
    )


def test_same_seed_same_observations_opaque_distinct_ids(setup_service):
    service, _ = setup_service
    a, b = create(service), create(service)
    assert a.scenario_id != b.scenario_id
    x, y = run(service.get_observations(a.scenario_id)), run(service.get_observations(b.scenario_id))
    assert x.nights == y.nights
    forbidden = {"fault_type", "severity", "leakage", "wall_h", "sensor_seed", "ground_truth"}

    def keys(value):
        if isinstance(value, dict):
            return set(value).union(*(keys(v) for v in value.values()))
        if isinstance(value, list):
            return set().union(*(keys(v) for v in value))
        return set()

    assert not keys(x.model_dump()) & forbidden


def test_public_observations_are_defensive_copies(setup_service):
    service, _ = setup_service
    item = create(service)
    a = run(service.get_observations(item.scenario_id))
    before = a.nights[0].room_temperature_series["kitchen"].values[0]
    a.nights[0].room_temperature_series["kitchen"].values[0] = 999
    b = run(service.get_observations(item.scenario_id))
    assert b.nights[0].room_temperature_series["kitchen"].values[0] == before


def test_full_flow_with_scripted_engine_not_scientific_accuracy(setup_service):
    service, engine = setup_service
    item = create(service)
    before = run(service.diagnose(item.scenario_id, DiagnoseRequest()))
    assert before.status == "ambiguous"
    request = ExperimentRequest(
        diagnosis_id=before.diagnosis_id, experiment_type="exhaust_fan_depressurization"
    )
    result = run(service.run_experiment(item.scenario_id, request))
    assert result.updated_diagnosis.status == "confident"
    assert run(service.run_experiment(item.scenario_id, request)) == result  # idempotent retry
    assert len(run(service.get_observations(item.scenario_id)).nights) == 2
    fix = RepairRequest(diagnosis_id=result.updated_diagnosis.diagnosis_id)
    repaired = run(service.apply_repair(item.scenario_id, fix))
    assert repaired.repair_type == FaultType.DRAFT
    assert repaired.estimated_savings is None and repaired.remeasured_savings_kwh is None
    assert repaired.original_observations != repaired.repaired_observations
    assert run(service.apply_repair(item.scenario_id, fix)) == repaired
    truth = run(service.reveal(item.scenario_id))
    assert truth.diagnosis_matched and truth.repair_addressed_cause
    assert engine.calls  # Public models only were supplied to fitter.
    for nights, _, template, _ in engine.calls:
        assert not hasattr(template, "fault")
        assert all(not hasattr(n, "fault") for n in nights)


def test_wrong_diagnosed_repair_does_not_fix_hidden_conduction_fault(setup_service):
    service, engine = setup_service
    engine.mode = "confident"  # Test double always says draft in Bedroom, intentionally wrong.
    item = run(
        service.create_scenario(
            ScenarioCreateRequest(
                mode="judge",
                judge_fault_type="envelope_conduction",
                judge_room_id="bedroom_1",
                severity=2,
                seed=2,
            )
        )
    )
    diagnosis = run(service.diagnose(item.scenario_id, DiagnoseRequest()))
    repair = run(service.apply_repair(item.scenario_id, RepairRequest(diagnosis_id=diagnosis.diagnosis_id)))
    assert repair.original_observations == repair.repaired_observations
    truth = run(service.reveal(item.scenario_id))
    assert not truth.diagnosis_matched and not truth.repair_addressed_cause


def test_cross_scenario_and_stale_diagnosis_ids_rejected(setup_service):
    service, _ = setup_service
    a, b = create(service), create(service)
    diagnosis = run(service.diagnose(a.scenario_id, DiagnoseRequest()))
    request = ExperimentRequest(
        diagnosis_id=diagnosis.diagnosis_id, experiment_type="exhaust_fan_depressurization"
    )
    with pytest.raises(ScenarioStateError, match="stale"):
        run(service.run_experiment(b.scenario_id, request))
    run(service.diagnose(a.scenario_id, DiagnoseRequest()))
    with pytest.raises(ScenarioStateError, match="stale"):
        run(service.run_experiment(a.scenario_id, request))


def test_failed_experiment_is_atomic_and_retryable(setup_service):
    service, engine = setup_service
    item = create(service)
    before = run(service.diagnose(item.scenario_id, DiagnoseRequest()))
    request = ExperimentRequest(
        diagnosis_id=before.diagnosis_id, experiment_type="exhaust_fan_depressurization"
    )
    engine.fail = True
    with pytest.raises(RuntimeError, match="injected"):
        run(service.run_experiment(item.scenario_id, request))
    assert len(run(service.get_observations(item.scenario_id)).nights) == 1
    engine.fail = False
    assert run(service.run_experiment(item.scenario_id, request)).updated_diagnosis.status == "confident"


def test_ambiguous_repairs_and_unknown_night_selection_rejected(setup_service):
    service, _ = setup_service
    item = create(service)
    diagnosis = run(service.diagnose(item.scenario_id, DiagnoseRequest()))
    with pytest.raises(ScenarioStateError, match="confident"):
        run(service.apply_repair(item.scenario_id, RepairRequest(diagnosis_id=diagnosis.diagnosis_id)))
    for selection in ([], ["someone-elses-night"], ["duplicate", "duplicate"]):
        with pytest.raises(ValueError, match="selection"):
            run(service.diagnose(item.scenario_id, DiagnoseRequest(observation_night_ids=selection)))


def test_no_engine_does_not_return_fake_diagnosis(setup_service):
    service, _ = setup_service
    service._controller = None
    item = create(service)
    with pytest.raises(EngineDependencyError):
        run(service.diagnose(item.scenario_id, DiagnoseRequest()))


def test_training_heldout_and_legacy_weather_boundaries(setup_service):
    service, _ = setup_service
    for bad in ("kisp-2020-01-01", "smeter-hh09-2021-01-06"):
        with pytest.raises(ValueError):
            create(service, weather_night_id=bad)
    with pytest.raises(ValueError, match="different"):
        create(
            service, weather_night_id="smeter-hh09-2019-12-01", experiment_night_id="smeter-hh09-2019-12-01"
        )
    heldout = HH09ScenarioService(split=Split.HELDOUT)
    item = create(heldout)
    assert (
        run(heldout.get_observations(item.scenario_id)).nights[0].weather.train_or_heldout_split == "heldout"
    )


def test_unknown_scenario_and_capacity_limits(setup_service):
    service, _ = setup_service
    service._limit = 1
    item = create(service)
    with pytest.raises(ScenarioStateError, match="capacity"):
        create(service)
    service.discard(item.scenario_id)
    with pytest.raises(KeyError, match="unknown"):
        run(service.get_observations(item.scenario_id))
    create(service)


def test_parallel_duplicate_experiment_requests_append_only_once(setup_service):
    service, _ = setup_service
    item = create(service)
    diagnosis = run(service.diagnose(item.scenario_id, DiagnoseRequest()))
    request = ExperimentRequest(
        diagnosis_id=diagnosis.diagnosis_id, experiment_type="exhaust_fan_depressurization"
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(service.run_experiment(item.scenario_id, request)), range(2)))
    assert results[0] == results[1]
    assert len(run(service.get_observations(item.scenario_id)).nights) == 2


def test_slow_simulation_does_not_block_async_api_loop(setup_service, monkeypatch):
    service, _ = setup_service
    original = service_module.simulate_night

    def slow(*args, **kwargs):
        time.sleep(0.1)  # Stand-in for an expensive numerical solve.
        return original(*args, **kwargs)

    monkeypatch.setattr(service_module, "simulate_night", slow)

    async def exercise():
        task = asyncio.create_task(
            service.create_scenario(
                ScenarioCreateRequest(
                    mode="guided",
                    guided_scenario_id=GUIDED_SCENARIO_ID,
                    seed=2,
                )
            )
        )
        await asyncio.sleep(0.01)
        assert not task.done(), "CPU work blocked the event loop until completion"
        await task

    run(exercise())


def test_real_weather_contract_blocker_is_explicit_not_faked():
    # When Nikhil approves nullable coordinates this test automatically validates the adapter instead.
    from backend.app.contracts import Location

    try:
        Location(name="unknown station", timezone="Europe/London", latitude=None, longitude=None)
    except ValueError:
        with pytest.raises(WeatherContractError, match="Nikhil"):
            load_simulation_weather("smeter-hh09-2019-12-01")
    else:
        weather = load_simulation_weather("smeter-hh09-2019-12-01")
        assert weather.location.latitude is None and weather.location.longitude is None


def test_existing_guided_fixture_identifier_remains_supported(setup_service):
    service, _ = setup_service
    created = run(
        service.create_scenario(
            ScenarioCreateRequest(
                mode="guided",
                guided_scenario_id="synthetic-guided-draft-01",
                seed=101,
            )
        )
    )
    assert run(service.get_observations(created.scenario_id)).nights


def test_modified_returned_diagnosis_cannot_authorize_a_repair(setup_service):
    service, _ = setup_service
    item = create(service)
    result = run(service.diagnose(item.scenario_id, DiagnoseRequest()))
    result.status = "confident"
    with pytest.raises(ScenarioStateError, match="confident"):
        run(service.apply_repair(item.scenario_id, RepairRequest(diagnosis_id=result.diagnosis_id)))


def test_evaluation_can_run_always_test_baseline_without_faking_recommendation(setup_service):
    service, engine = setup_service
    engine.mode = "healthy"
    item = create(service)
    diagnosis = run(service.diagnose(item.scenario_id, DiagnoseRequest()))
    assert diagnosis.test_decision is None
    request = ExperimentRequest(
        diagnosis_id=diagnosis.diagnosis_id, experiment_type="exhaust_fan_depressurization"
    )
    with pytest.raises(ScenarioStateError, match="recommended"):
        run(service.run_experiment(item.scenario_id, request))
    result = run(service.run_experiment(item.scenario_id, request, force_for_evaluation=True))
    assert result.updated_diagnosis.status == "no_fault"


def test_outdated_generic_house_template_is_rejected():
    import json
    from pathlib import Path

    from backend.app.contracts import PublicTemplate

    template = PublicTemplate.model_validate(
        json.loads(
            Path("shared/fixtures/public_template.json").read_text(),
        )
    )
    controller = DiagnosisController(ScriptedEngine(), template, Thresholds(10, 5, 0.5))
    with pytest.raises(EngineDependencyError, match="HH09"):
        HH09ScenarioService(controller)


def test_healthy_judge_case_normalizes_truth_without_a_fake_fault_room(setup_service):
    service, engine = setup_service
    engine.mode = "healthy"
    item = run(
        service.create_scenario(
            ScenarioCreateRequest(
                mode="judge",
                judge_fault_type="none",
                judge_room_id="bedroom_1",
                severity=1,
                seed=2,
            )
        )
    )
    run(service.diagnose(item.scenario_id, DiagnoseRequest()))
    truth = run(service.reveal(item.scenario_id))
    assert truth.actual_room_id is None and truth.severity == 0 and truth.diagnosis_matched
