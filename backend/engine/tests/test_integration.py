"""End-to-end wiring with Mihir's service and controller (orchestration only, not accuracy)."""

from __future__ import annotations

import asyncio

from backend.app.contracts import DiagnoseRequest, Diagnosis, ScenarioCreateRequest
from backend.diagnosis import DiagnosisController, Thresholds
from backend.engine import PublicModelEngine, PublicMoneyEstimator, load_public_template
from backend.simulation import HH09ScenarioService


def test_calibrated_engine_runs_a_real_diagnosis_through_the_scenario_service():
    template = load_public_template()
    thresholds = Thresholds(detection_bic=100.0, ambiguity_bic=50.0, adequacy_rmse=0.3)
    service = HH09ScenarioService(
        DiagnosisController(PublicModelEngine(), template, thresholds),
        financial_estimator=PublicMoneyEstimator(template),
    )

    async def run() -> Diagnosis:
        created = await service.create_scenario(
            ScenarioCreateRequest(
                mode="judge",
                judge_fault_type="envelope_conduction",
                judge_room_id="bedroom_1",
                severity=3.0,
                seed=4242,
            )
        )
        return await service.diagnose(created.scenario_id, DiagnoseRequest())

    diagnosis = asyncio.run(run())
    Diagnosis.model_validate(diagnosis.model_dump())
    assert len(diagnosis.ranked_causes) in (0, 2)
    if diagnosis.ranked_causes:
        assert all(0.3 <= fit.fitted_multiplier <= 6 for fit in diagnosis.ranked_causes)
