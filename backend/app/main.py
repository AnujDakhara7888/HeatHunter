"""HeatHunter FastAPI application scaffold."""

from __future__ import annotations

from typing import NoReturn

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from .contracts import (
    ApiError,
    DiagnoseRequest,
    Diagnosis,
    EvaluationSummary,
    ExperimentRequest,
    ExperimentResponse,
    GroundTruth,
    HealthResponse,
    ObservationResponse,
    RealHouse,
    RepairRequest,
    RepairResult,
    ScenarioCreated,
    ScenarioCreateRequest,
)

app = FastAPI(
    title="HeatHunter API",
    version="0.1.0",
    description=(
        "Physics-guided home thermal diagnostic prototype. This is a preliminary "
        "diagnostic concept, not a certified building energy audit."
    ),
)

NOT_IMPLEMENTED = {
    status.HTTP_501_NOT_IMPLEMENTED: {
        "model": ApiError,
        "description": "The owning scientific or data service has not been integrated.",
    }
}


class ServiceNotIntegratedError(RuntimeError):
    """Raised by a route whose owning implementation has not been connected."""


@app.exception_handler(ServiceNotIntegratedError)
async def service_not_integrated_handler(
    request: Request,
    exc: ServiceNotIntegratedError,
) -> JSONResponse:
    del request
    payload = ApiError(detail=str(exc), code="SERVICE_NOT_INTEGRATED")
    return JSONResponse(status_code=status.HTTP_501_NOT_IMPLEMENTED, content=payload.model_dump())


def _service_not_integrated(service: str) -> NoReturn:
    raise ServiceNotIntegratedError(f"{service} is not integrated")


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse()


@app.post(
    "/api/scenarios",
    response_model=ScenarioCreated,
    status_code=status.HTTP_201_CREATED,
    responses=NOT_IMPLEMENTED,
    tags=["fault-lab"],
)
async def create_scenario(request: ScenarioCreateRequest) -> ScenarioCreated:
    del request
    _service_not_integrated("scenario service")


@app.get(
    "/api/scenarios/{id}/observations",
    response_model=ObservationResponse,
    responses=NOT_IMPLEMENTED,
    tags=["fault-lab"],
)
async def get_observations(id: str) -> ObservationResponse:
    del id
    _service_not_integrated("scenario service")


@app.post(
    "/api/scenarios/{id}/diagnose",
    response_model=Diagnosis,
    responses=NOT_IMPLEMENTED,
    tags=["fault-lab"],
)
async def diagnose(id: str, request: DiagnoseRequest) -> Diagnosis:
    del id, request
    _service_not_integrated("diagnosis service")


@app.post(
    "/api/scenarios/{id}/experiments",
    response_model=ExperimentResponse,
    responses=NOT_IMPLEMENTED,
    tags=["fault-lab"],
)
async def run_experiment(id: str, request: ExperimentRequest) -> ExperimentResponse:
    del id, request
    _service_not_integrated("experiment service")


@app.post(
    "/api/scenarios/{id}/repair",
    response_model=RepairResult,
    responses=NOT_IMPLEMENTED,
    tags=["fault-lab"],
)
async def apply_repair(id: str, request: RepairRequest) -> RepairResult:
    del id, request
    _service_not_integrated("repair service")


@app.get(
    "/api/scenarios/{id}/reveal",
    response_model=GroundTruth,
    responses=NOT_IMPLEMENTED,
    tags=["fault-lab"],
)
async def reveal(id: str) -> GroundTruth:
    del id
    _service_not_integrated("truth store")


@app.get(
    "/api/real/house",
    response_model=RealHouse,
    responses=NOT_IMPLEMENTED,
    tags=["real-homes"],
)
async def get_real_house() -> RealHouse:
    _service_not_integrated("real-house data service")


@app.get(
    "/api/evaluation/summary",
    response_model=EvaluationSummary,
    responses=NOT_IMPLEMENTED,
    tags=["evaluation"],
)
async def get_evaluation_summary() -> EvaluationSummary:
    _service_not_integrated("evaluation service")
