"""Service interfaces implemented by the scientific modules.

The API layer depends on these public signatures, never on private simulator
state. Ground truth is intentionally available only through ``reveal``.
"""

from __future__ import annotations

from typing import Protocol

from .contracts import (
    DiagnoseRequest,
    Diagnosis,
    EvaluationSummary,
    ExperimentRequest,
    ExperimentResponse,
    GroundTruth,
    ObservationResponse,
    RealHouse,
    RepairRequest,
    RepairResult,
    ScenarioCreated,
    ScenarioCreateRequest,
)


class ScenarioService(Protocol):
    async def create_scenario(self, request: ScenarioCreateRequest) -> ScenarioCreated: ...

    async def get_observations(self, scenario_id: str) -> ObservationResponse: ...

    async def diagnose(self, scenario_id: str, request: DiagnoseRequest) -> Diagnosis: ...

    async def run_experiment(self, scenario_id: str, request: ExperimentRequest) -> ExperimentResponse: ...

    async def apply_repair(self, scenario_id: str, request: RepairRequest) -> RepairResult: ...

    async def reveal(self, scenario_id: str) -> GroundTruth: ...


class RealHouseService(Protocol):
    async def get_selected_house(self) -> RealHouse: ...


class EvaluationService(Protocol):
    async def get_summary(self) -> EvaluationSummary: ...
