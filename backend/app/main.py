"""HeatHunter FastAPI application.

Routes delegate to the owners' services (see ``runtime.py``). Errors map to
explicit status codes; an unavailable scientific dependency is a 501, never a
fabricated success.
"""

from __future__ import annotations

from pathlib import Path
from typing import NoReturn

from fastapi import FastAPI, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .contracts import (
    ApiError,
    DiagnoseRequest,
    Diagnosis,
    DiagnosisStatus,
    EvaluationSummary,
    ExperimentRequest,
    ExperimentResponse,
    GroundTruth,
    HealthResponse,
    MoneyRequest,
    MoneyResponse,
    ObservationResponse,
    RealHouse,
    RepairRequest,
    RepairResult,
    ScenarioCreated,
    ScenarioCreateRequest,
)
from .runtime import (
    REPOSITORY_ROOT,
    ThresholdsUnavailableError,
    get_runtime,
    load_evaluation_summary,
)

app = FastAPI(
    title="HeatHunter API",
    version="0.2.0",
    description=(
        "Physics-guided home thermal diagnostic prototype. This is a preliminary "
        "diagnostic concept, not a certified building energy audit."
    ),
)


def _errors(*codes: int) -> dict[int | str, dict]:
    descriptions = {
        status.HTTP_404_NOT_FOUND: "Unknown scenario, diagnosis or asset.",
        status.HTTP_409_CONFLICT: "The action is not valid in the scenario's current state.",
        status.HTTP_422_UNPROCESSABLE_CONTENT: "The request is invalid for this scenario.",
        status.HTTP_501_NOT_IMPLEMENTED: "The owning scientific or data service is not available.",
    }
    return {code: {"model": ApiError, "description": descriptions[code]} for code in codes}


SCENARIO_ERRORS = _errors(404, 409, 422, 501)


class ServiceNotIntegratedError(RuntimeError):
    """Raised by a route whose owning implementation is not available."""


class ApiFailure(Exception):
    def __init__(self, status_code: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status_code, self.code, self.detail = status_code, code, detail


def _payload(status_code: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=ApiError(detail=detail, code=code).model_dump())


@app.exception_handler(ServiceNotIntegratedError)
async def service_not_integrated_handler(request: Request, exc: ServiceNotIntegratedError) -> JSONResponse:
    del request
    return _payload(status.HTTP_501_NOT_IMPLEMENTED, "SERVICE_NOT_INTEGRATED", str(exc))


@app.exception_handler(ApiFailure)
async def api_failure_handler(request: Request, exc: ApiFailure) -> JSONResponse:
    del request
    return _payload(exc.status_code, exc.code, exc.detail)


def _service_not_integrated(service: str) -> NoReturn:
    raise ServiceNotIntegratedError(f"{service} is not integrated")


def _runtime():
    try:
        return get_runtime()
    except ThresholdsUnavailableError as exc:
        raise ServiceNotIntegratedError(f"diagnosis service is not integrated: {exc}") from exc


async def _call(awaitable):
    """Translate owner-service exceptions into explicit API errors."""

    from backend.diagnosis import EngineDependencyError
    from backend.simulation import ScenarioStateError
    from backend.simulation.weather_bridge import WeatherContractError

    try:
        return await awaitable
    except KeyError as exc:
        raise ApiFailure(404, "NOT_FOUND", str(exc.args[0]) if exc.args else "not found") from exc
    except ScenarioStateError as exc:
        raise ApiFailure(409, "INVALID_SCENARIO_STATE", str(exc)) from exc
    except (EngineDependencyError, WeatherContractError) as exc:
        raise ApiFailure(501, "SERVICE_NOT_INTEGRATED", str(exc)) from exc
    except ValueError as exc:
        raise ApiFailure(422, "INVALID_REQUEST", str(exc)) from exc


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse()


@app.post(
    "/api/scenarios",
    response_model=ScenarioCreated,
    status_code=status.HTTP_201_CREATED,
    responses=SCENARIO_ERRORS,
    tags=["fault-lab"],
)
async def create_scenario(request: ScenarioCreateRequest) -> ScenarioCreated:
    runtime = _runtime()
    created = await _call(runtime.scenarios.create_scenario(request))
    runtime.track_scenario(created.scenario_id)
    return created


@app.get(
    "/api/scenarios/{id}/observations",
    response_model=ObservationResponse,
    responses=SCENARIO_ERRORS,
    tags=["fault-lab"],
)
async def get_observations(id: str) -> ObservationResponse:
    return await _call(_runtime().scenarios.get_observations(id))


@app.post(
    "/api/scenarios/{id}/diagnose",
    response_model=Diagnosis,
    responses=SCENARIO_ERRORS,
    tags=["fault-lab"],
)
async def diagnose(id: str, request: DiagnoseRequest) -> Diagnosis:
    runtime = _runtime()
    result = await _call(runtime.scenarios.diagnose(id, request))
    return runtime.disclose(id, result)


@app.post(
    "/api/scenarios/{id}/experiments",
    response_model=ExperimentResponse,
    responses=SCENARIO_ERRORS,
    tags=["fault-lab"],
)
async def run_experiment(id: str, request: ExperimentRequest) -> ExperimentResponse:
    runtime = _runtime()
    result = await _call(runtime.scenarios.run_experiment(id, request))
    return result.model_copy(update={"updated_diagnosis": runtime.disclose(id, result.updated_diagnosis)})


@app.post(
    "/api/scenarios/{id}/money",
    response_model=MoneyResponse,
    responses=SCENARIO_ERRORS,
    tags=["fault-lab"],
)
async def estimate_money(id: str, request: MoneyRequest) -> MoneyResponse:
    """Re-price a diagnosis with user tariff/repair-cost overrides via the public engine."""

    from backend.engine import MoneyOverrides
    from backend.engine import estimate_money as engine_estimate

    runtime = _runtime()
    try:
        diagnosis = runtime.diagnosis(id, request.diagnosis_id)
    except KeyError as exc:
        raise ApiFailure(404, "NOT_FOUND", str(exc.args[0])) from exc
    if diagnosis.status != DiagnosisStatus.CONFIDENT or not diagnosis.ranked_causes:
        return MoneyResponse(
            diagnosis_id=diagnosis.diagnosis_id,
            estimate=None,
            explanation=f"No money estimate: the diagnosis is {diagnosis.status.value}, not confident.",
        )
    estimate = engine_estimate(
        runtime.template,
        diagnosis.flagged_room_id,
        diagnosis.ranked_causes[0],
        overrides=MoneyOverrides(
            gas_price_pence_per_kwh=request.gas_price_pence_per_kwh,
            repair_cost_gbp=request.repair_cost_gbp,
        ),
    )
    return MoneyResponse(
        diagnosis_id=diagnosis.diagnosis_id,
        estimate=estimate,
        explanation=(
            "Screening estimate from the fitted excess heat-loss path and the stated assumptions."
            if estimate
            else "The fitted cause does not indicate an excess heat-loss path to price."
        ),
    )


@app.post(
    "/api/scenarios/{id}/repair",
    response_model=RepairResult,
    responses=SCENARIO_ERRORS,
    tags=["fault-lab"],
)
async def apply_repair(id: str, request: RepairRequest) -> RepairResult:
    service = _runtime().scenarios
    return await _call(service.apply_repair(id, request, effectiveness=request.effectiveness))


@app.get(
    "/api/scenarios/{id}/reveal",
    response_model=GroundTruth,
    responses=SCENARIO_ERRORS,
    tags=["fault-lab"],
)
async def reveal(id: str) -> GroundTruth:
    return await _call(_runtime().scenarios.reveal(id))


@app.get(
    "/api/real/house",
    response_model=RealHouse,
    responses=_errors(501),
    tags=["real-homes"],
)
async def get_real_house() -> RealHouse:
    from backend.data_pipeline import load_real_house

    try:
        return load_real_house()
    except FileNotFoundError as exc:
        raise ServiceNotIntegratedError(f"real-house data is not available: {exc}") from exc


@app.get(
    "/api/real/house/floor-plan",
    response_class=FileResponse,
    responses={**_errors(404), 200: {"content": {"image/png": {}}, "description": "Original floor plan"}},
    tags=["real-homes"],
)
async def get_real_house_floor_plan() -> FileResponse:
    """The original published floor-plan image referenced by ``RealHouse.floor_plan_asset_path``."""

    from backend.data_pipeline import load_real_house

    path = (REPOSITORY_ROOT / load_real_house().floor_plan_asset_path).resolve()
    if not path.is_relative_to(REPOSITORY_ROOT / "data") or not path.is_file():
        raise ApiFailure(404, "NOT_FOUND", "floor-plan image is not available")
    return FileResponse(path, media_type="image/png")


@app.get(
    "/api/evaluation/summary",
    response_model=EvaluationSummary,
    responses=_errors(501),
    tags=["evaluation"],
)
async def get_evaluation_summary() -> EvaluationSummary:
    summary = load_evaluation_summary()
    if summary is None:
        raise ServiceNotIntegratedError(
            "evaluation service is not integrated: the held-out benchmark report has not been generated"
        )
    return summary


# Serve the built frontend for the offline single-process demo, if present.
_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="frontend")
