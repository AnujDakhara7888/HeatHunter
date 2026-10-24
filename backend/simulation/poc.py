"""Numerical PoC harness to run ONLY with Kailash's actual public engine.

The implementation deliberately contains no substitute fitter or success seed
search. The guided seed remains a candidate until this reports genuine success.
"""

from __future__ import annotations

from backend.app.contracts import (
    DiagnoseRequest,
    DiagnosisStatus,
    ExperimentRequest,
    FaultType,
    RepairRequest,
    ScenarioCreateRequest,
)
from backend.diagnosis import DiagnosisController

from .service import HH09ScenarioService


async def run_poc(controller: DiagnosisController) -> dict:
    service = HH09ScenarioService(controller)
    records = []
    for kind in (FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION, FaultType.NONE):
        created = await service.create_scenario(
            ScenarioCreateRequest(
                mode="judge", judge_fault_type=kind, judge_room_id="bedroom_1", severity=2, seed=20261024
            ),
            weather_night_id="smeter-hh09-2019-12-01",
            experiment_night_id="smeter-hh09-2020-12-06",
        )
        before = await service.diagnose(created.scenario_id, DiagnoseRequest())
        after = before
        if before.test_decision and before.test_decision.recommended:
            experiment = await service.run_experiment(
                created.scenario_id,
                ExperimentRequest(
                    diagnosis_id=before.diagnosis_id,
                    experiment_type="exhaust_fan_depressurization",
                ),
            )
            after = experiment.updated_diagnosis
        repair = None
        if after.status == DiagnosisStatus.CONFIDENT:
            repair = await service.apply_repair(
                created.scenario_id, RepairRequest(diagnosis_id=after.diagnosis_id)
            )
        truth = await service.reveal(created.scenario_id)
        records.append(
            {
                "actual_fault": kind.value,
                "before": before.model_dump(mode="json"),
                "after": after.model_dump(mode="json"),
                "diagnosis_matched": truth.diagnosis_matched,
                "repair_addressed_cause": truth.repair_addressed_cause,
                "repair_result": repair.diagnosed_improvement if repair else None,
            }
        )
    return {
        "title": "TRAINING-only numerical PoC, not a held-out benchmark",
        "any_passive_ambiguity": any(r["before"]["status"] == "ambiguous" for r in records),
        "any_test_recommended": any(
            (r["before"]["test_decision"] or {}).get("recommended", False) for r in records
        ),
        "all_cases_correct": all(r["diagnosis_matched"] for r in records),
        "records": records,
    }
