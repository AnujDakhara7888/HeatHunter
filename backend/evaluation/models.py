"""Inputs recorded by the future scenario/diagnosis benchmark runner."""

from __future__ import annotations

from dataclasses import dataclass

from backend.app.contracts import DiagnosisStatus, FaultType


@dataclass(frozen=True, slots=True)
class EvaluationRecord:
    scenario_id: str
    actual_fault_type: FaultType
    actual_room_id: str | None
    pre_status: DiagnosisStatus
    pre_predicted_fault_type: FaultType | None
    pre_predicted_room_id: str | None
    experiment_recommended: bool = False
    experiment_run: bool = False
    post_status: DiagnosisStatus | None = None
    post_predicted_fault_type: FaultType | None = None
    post_predicted_room_id: str | None = None
    baseline_strategy_correct: bool | None = None

    def __post_init__(self) -> None:
        if not self.scenario_id:
            raise ValueError("scenario_id is required")
        if self.actual_fault_type == FaultType.NONE and self.actual_room_id is not None:
            raise ValueError("healthy scenarios cannot have an actual room")
        if self.actual_fault_type != FaultType.NONE and self.actual_room_id is None:
            raise ValueError("fault scenarios require an actual room")
        if self.pre_status == DiagnosisStatus.CONFIDENT and self.pre_predicted_fault_type is None:
            raise ValueError("confident pre-experiment diagnoses require a predicted fault")
        if self.experiment_run and self.post_status is None:
            raise ValueError("experiment runs require a post-experiment diagnosis")
        if not self.experiment_run and any(
            value is not None
            for value in (
                self.post_status,
                self.post_predicted_fault_type,
                self.post_predicted_room_id,
            )
        ):
            raise ValueError("post-experiment fields require experiment_run=True")
