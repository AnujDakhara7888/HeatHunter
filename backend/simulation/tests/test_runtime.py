from __future__ import annotations

import asyncio
import json

import pytest

from backend.app.contracts import DiagnoseRequest, ExperimentRequest, RepairRequest, ScenarioCreateRequest
from backend.diagnosis.settings import DEFAULT_SETTINGS_PATH, DecisionSettingsError
from backend.simulation import GUIDED_INSULATION_ID, GUIDED_SCENARIO_ID
from backend.simulation.runtime import build_scenario_service


def test_real_engine_labelled_training_demo_completes_full_loop():
    async def exercise():
        service = build_scenario_service()
        item = await service.create_scenario(
            ScenarioCreateRequest(mode="guided", guided_scenario_id=GUIDED_INSULATION_ID)
        )
        before = await service.diagnose(item.scenario_id, DiagnoseRequest())
        assert before.status == "ambiguous" and before.test_decision.recommended
        result = await service.run_experiment(
            item.scenario_id,
            ExperimentRequest(
                diagnosis_id=before.diagnosis_id, experiment_type="exhaust_fan_depressurization"
            ),
        )
        after = result.updated_diagnosis
        assert after.status == "confident"
        assert after.ranked_causes[0].fault_type == "envelope_conduction"
        assert after.money_estimate is not None
        repair = await service.apply_repair(item.scenario_id, RepairRequest(diagnosis_id=after.diagnosis_id))
        assert "no_fault" in repair.diagnosed_improvement
        truth = await service.reveal(item.scenario_id)
        assert truth.diagnosis_matched and truth.repair_addressed_cause

    asyncio.run(exercise())


def test_existing_draft_example_does_not_get_a_forced_confident_answer():
    async def exercise():
        service = build_scenario_service()
        item = await service.create_scenario(
            ScenarioCreateRequest(mode="guided", guided_scenario_id=GUIDED_SCENARIO_ID)
        )
        before = await service.diagnose(item.scenario_id, DiagnoseRequest())
        assert before.status == "ambiguous"
        after = before
        if before.test_decision.recommended:
            result = await service.run_experiment(
                item.scenario_id,
                ExperimentRequest(
                    diagnosis_id=before.diagnosis_id, experiment_type="exhaust_fan_depressurization"
                ),
            )
            after = result.updated_diagnosis
        # Unresolved either way: no test offered, or the test ran and still could not separate.
        assert after.status in {"ambiguous", "unexplained"}
        assert after.money_estimate is None

    asyncio.run(exercise())


def test_model_and_weather_asset_changes_are_rejected_without_reading_arbitrary_paths(tmp_path):
    data = json.loads(DEFAULT_SETTINGS_PATH.read_text())
    data["weather_assets"] = {"../../not-a-weather-file": "invalid"}
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(data))
    with pytest.raises(DecisionSettingsError, match="weather"):
        build_scenario_service(settings_path=path)


def test_mismatched_simulator_fingerprint_rejected(tmp_path):
    data = json.loads(DEFAULT_SETTINGS_PATH.read_text())
    data["simulator_assets"]["backend/simulation/physics.py"] = "outdated"
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(data))
    with pytest.raises(DecisionSettingsError, match="simulator"):
        build_scenario_service(settings_path=path)
