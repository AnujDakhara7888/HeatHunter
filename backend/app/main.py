"""HeatHunter FastAPI application.

Routes delegate to the owners' services (see ``runtime.py``). Errors map to
explicit status codes; an unavailable scientific dependency is a 501, never a
fabricated success.
"""

from __future__ import annotations

import threading
from datetime import datetime
from pathlib import Path
from typing import Annotated, NoReturn

from fastapi import FastAPI, File, Query, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .contracts import (
    AdvanceRequest,
    ApiError,
    ChatReply,
    ChatRequest,
    DemoHomeCreate,
    DemoReveal,
    DiagnoseRequest,
    Diagnosis,
    DiagnosisStatus,
    EvaluationSummary,
    ExperimentRequest,
    ExperimentResponse,
    FixRequest,
    FloorPlanDraft,
    GroundTruth,
    HealthResponse,
    HomeAnalysis,
    HomeAnalyzeRequest,
    HomeChatRequest,
    HomeCreate,
    HomeHealth,
    HomePlan,
    HomeReadings,
    HomeSummary,
    HomeTemplate,
    InsightRequest,
    InsightResponse,
    MoneyRequest,
    MoneyResponse,
    ObservationResponse,
    PredictionRequest,
    PredictionResponse,
    ReadingsUpload,
    RealHouse,
    RepairRequest,
    RepairResult,
    RoomReport,
    RoomTechnical,
    ScenarioCreated,
    ScenarioCreateRequest,
    WeatherLookup,
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
        status.HTTP_503_SERVICE_UNAVAILABLE: "An optional online service (Claude, weather) is unavailable.",
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


@app.post("/api/insight/fits", response_model=InsightResponse, responses=_errors(422, 501), tags=["insight"])
async def insight_fits(request: InsightRequest) -> InsightResponse:
    """Fit normal / draft / insulation per room and return each hypothesis's predicted curve."""

    from backend.engine import PublicModelError

    from .insight import room_insights

    template = request.template or _runtime().template
    try:
        rooms, evaluations, elapsed = await run_in_threadpool(
            room_insights, request.nights, template, request.room_ids
        )
    except (PublicModelError, ValueError) as exc:
        raise ApiFailure(422, "INVALID_REQUEST", str(exc)) from exc
    return InsightResponse(
        template_id=template.template_id, rooms=rooms, model_evaluations=evaluations, elapsed_ms=elapsed
    )


@app.post(
    "/api/insight/predict", response_model=PredictionResponse, responses=_errors(422, 501), tags=["insight"]
)
async def insight_predict(request: PredictionRequest) -> PredictionResponse:
    """Forward-predict a night under competing fitted hypotheses (out-of-sample check)."""

    import time

    from backend.engine import PublicModelError

    from .insight import predict_night

    template = request.template or _runtime().template
    started = time.perf_counter()
    try:
        predictions = await run_in_threadpool(
            predict_night, template, request.room_id, request.causes, request.night
        )
    except (PublicModelError, ValueError) as exc:
        raise ApiFailure(422, "INVALID_REQUEST", str(exc)) from exc
    return PredictionResponse(
        room_id=request.room_id,
        night_id=request.night.night_id,
        predictions=predictions,
        elapsed_ms=(time.perf_counter() - started) * 1000,
    )


@app.get("/api/homes/sample-plan", response_model=HomePlan, tags=["homes"])
async def sample_plan() -> HomePlan:
    """The documented HH09 plan, in the same format a user's plan uses."""

    return HomePlan.model_validate_json((REPOSITORY_ROOT / "shared" / "homes" / "hh09_plan.json").read_text())


@app.post("/api/homes/template", response_model=HomeTemplate, responses=_errors(422), tags=["homes"])
async def home_template(plan: HomePlan) -> HomeTemplate:
    from .homes import HomeError, build_home

    try:
        return build_home(plan)[0]
    except HomeError as exc:
        raise ApiFailure(422, "INVALID_REQUEST", str(exc)) from exc


@app.post("/api/homes/analyze", response_model=HomeAnalysis, responses=_errors(422, 501), tags=["homes"])
async def home_analyze(request: HomeAnalyzeRequest) -> HomeAnalysis:
    """Screen a user's own readings with the public engine (no fault labels exist for real homes)."""

    from backend.engine import PublicModelError

    from .homes import HomeError, analyze_home

    passive = _runtime().thresholds.passive
    try:
        return await run_in_threadpool(
            lambda: analyze_home(
                request,
                detection_bic=passive.detection_bic,
                ambiguity_bic=passive.ambiguity_bic,
                adequacy_rmse=passive.adequacy_rmse,
            )
        )
    except (HomeError, PublicModelError, ValueError) as exc:
        raise ApiFailure(422, "INVALID_REQUEST", str(exc)) from exc


@app.get("/api/weather/lookup", response_model=WeatherLookup, responses=_errors(422, 503), tags=["homes"])
async def weather_lookup(
    query: Annotated[str, Query(min_length=2, max_length=80)],
    start: Annotated[datetime, Query()],
    end: Annotated[datetime, Query()],
) -> WeatherLookup:
    """Hourly gridded weather for a place and time window (needs internet)."""

    from .homes import HomeError, lookup_weather

    try:
        return await run_in_threadpool(lookup_weather, query, start, end)
    except HomeError as exc:
        raise ApiFailure(422, "INVALID_REQUEST", str(exc)) from exc
    except OSError as exc:
        raise ApiFailure(503, "WEATHER_UNAVAILABLE", f"weather service unreachable: {exc}") from exc


@app.post("/api/assistant/chat", response_model=ChatReply, responses=_errors(422, 503), tags=["assistant"])
async def assistant_chat(request: ChatRequest) -> ChatReply:
    from .assistant import AssistantUnavailable, chat

    try:
        return await run_in_threadpool(chat, request)
    except AssistantUnavailable as exc:
        raise ApiFailure(503, "ASSISTANT_UNAVAILABLE", str(exc)) from exc


@app.post(
    "/api/assistant/floor-plan",
    response_model=FloorPlanDraft,
    responses=_errors(422, 503),
    tags=["assistant"],
)
async def assistant_floor_plan(file: Annotated[UploadFile, File()]) -> FloorPlanDraft:
    from .assistant import AssistantUnavailable, read_floor_plan

    content = await file.read()
    if len(content) > 15 * 1024 * 1024:
        raise ApiFailure(422, "INVALID_REQUEST", "floor plan must be under 15 MB")
    try:
        return await run_in_threadpool(read_floor_plan, content, file.content_type or "")
    except AssistantUnavailable as exc:
        raise ApiFailure(503, "ASSISTANT_UNAVAILABLE", str(exc)) from exc
    except ValueError as exc:
        raise ApiFailure(422, "INVALID_REQUEST", str(exc)) from exc


# ---------------------------------------------------------------------------
# API v2: homes monitored night after night (docs/CONTRACTS.md, "API v2").
# ---------------------------------------------------------------------------

V2_ERRORS = _errors(404, 409, 422, 501, 503)
_home_service_lock = threading.Lock()
_home_service = None


def _homes():
    from backend.diagnosis.settings import DecisionSettingsError

    from .monitoring_service import HomeService

    global _home_service
    with _home_service_lock:
        if _home_service is None:
            try:
                _home_service = HomeService()
            except DecisionSettingsError as exc:
                raise ServiceNotIntegratedError(f"monitoring rule is not available: {exc}") from exc
        return _home_service


def reset_home_service() -> None:
    """Testing hook: forget all homes held in memory (real homes reload from disk)."""

    global _home_service
    with _home_service_lock:
        _home_service = None


async def _v2(function, *args):
    from backend.diagnosis.settings import DecisionSettingsError

    from .homes import HomeError
    from .monitoring_service import HomeStateError

    try:
        return await run_in_threadpool(function, *args)
    except KeyError as exc:
        raise ApiFailure(404, "NOT_FOUND", str(exc.args[0]) if exc.args else "not found") from exc
    except HomeStateError as exc:
        raise ApiFailure(409, "INVALID_HOME_STATE", str(exc)) from exc
    except DecisionSettingsError as exc:
        raise ApiFailure(501, "SERVICE_NOT_INTEGRATED", str(exc)) from exc
    except (HomeError, ValueError) as exc:
        raise ApiFailure(422, "INVALID_REQUEST", str(exc)) from exc
    except OSError as exc:
        raise ApiFailure(503, "WEATHER_UNAVAILABLE", f"weather service unreachable: {exc}") from exc


@app.get("/api/homes", response_model=list[HomeSummary], responses=V2_ERRORS, tags=["homes-v2"])
async def list_homes() -> list[HomeSummary]:
    """House picker: every demo and real home."""

    return await _v2(_homes().list_homes)


@app.post(
    "/api/demo/homes",
    response_model=HomeSummary,
    status_code=status.HTTP_201_CREATED,
    responses=V2_ERRORS,
    tags=["homes-v2"],
)
async def create_demo_home(request: DemoHomeCreate) -> HomeSummary:
    """Load any scenario on the simulated HH09 twin: a chosen fault, a random hidden one, or none."""

    return await _v2(_homes().create_demo, request)


@app.post(
    "/api/homes",
    response_model=HomeSummary,
    status_code=status.HTTP_201_CREATED,
    responses=V2_ERRORS,
    tags=["homes-v2"],
)
async def create_home(request: HomeCreate) -> HomeSummary:
    """Set up a real home from its plan, location and heating-off hours."""

    return await _v2(_homes().create_real, request)


@app.get("/api/homes/{home_id}", response_model=HomeHealth, responses=V2_ERRORS, tags=["homes-v2"])
async def home_health(home_id: str) -> HomeHealth:
    """Every room's status in plain words."""

    return await _v2(_homes().health, home_id)


@app.get("/api/homes/{home_id}/readings", response_model=HomeReadings, responses=V2_ERRORS, tags=["homes-v2"])
async def home_readings(
    home_id: str,
    start: Annotated[datetime | None, Query(alias="from")] = None,
    end: Annotated[datetime | None, Query(alias="to")] = None,
    room_id: str | None = None,
) -> HomeReadings:
    """Chart data: measured room temperatures, weather and the engine's expected-if-healthy line."""

    return await _v2(_homes().readings, home_id, start, end, room_id)


@app.post("/api/homes/{home_id}/readings", response_model=HomeHealth, responses=V2_ERRORS, tags=["homes-v2"])
async def upload_readings(home_id: str, request: ReadingsUpload) -> HomeHealth:
    """Sensor readings for a real home; weather is fetched for its location."""

    return await _v2(_homes().upload, home_id, request)


@app.get(
    "/api/homes/{home_id}/rooms/{room_id}", response_model=RoomReport, responses=V2_ERRORS, tags=["homes-v2"]
)
async def room_report(home_id: str, room_id: str) -> RoomReport:
    """One room: why, what to do, cost and the evidence night by night."""

    return await _v2(_homes().room_report, home_id, room_id)


@app.get(
    "/api/homes/{home_id}/rooms/{room_id}/technical",
    response_model=RoomTechnical,
    responses=V2_ERRORS,
    tags=["homes-v2"],
)
async def room_technical(home_id: str, room_id: str) -> RoomTechnical:
    """Fits, scores and thresholds behind a room's status (for a details panel)."""

    return await _v2(_homes().room_technical, home_id, room_id)


@app.post(
    "/api/homes/{home_id}/rooms/{room_id}/fix",
    response_model=RoomReport,
    responses=V2_ERRORS,
    tags=["homes-v2"],
)
async def report_fix(home_id: str, room_id: str, request: FixRequest) -> RoomReport:
    """'I've fixed it': the room is re-judged on nights after the fix only."""

    return await _v2(_homes().report_fix, home_id, room_id, request)


@app.post(
    "/api/demo/homes/{home_id}/advance", response_model=HomeHealth, responses=V2_ERRORS, tags=["homes-v2"]
)
async def advance_demo(home_id: str, request: AdvanceRequest) -> HomeHealth:
    """Run the demo house through its next heating-off nights."""

    return await _v2(_homes().advance, home_id, request.nights)


@app.get(
    "/api/demo/homes/{home_id}/reveal", response_model=DemoReveal, responses=V2_ERRORS, tags=["homes-v2"]
)
async def reveal_demo(home_id: str) -> DemoReveal:
    """The hidden fault, whether the app found it, and the same night without the fault."""

    return await _v2(_homes().reveal, home_id)


@app.post("/api/homes/{home_id}/assistant", response_model=ChatReply, responses=V2_ERRORS, tags=["homes-v2"])
async def home_assistant(home_id: str, request: HomeChatRequest) -> ChatReply:
    """Chat about this home. The server supplies the home's public data; Claude only."""

    from .assistant import AssistantUnavailable, home_chat

    context = await _v2(_homes().assistant_context, home_id)
    try:
        return await run_in_threadpool(home_chat, request.messages, context)
    except AssistantUnavailable as exc:
        raise ApiFailure(503, "ASSISTANT_UNAVAILABLE", str(exc)) from exc


# Serve the built frontend for the offline single-process demo, if present.
_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


class _SinglePageApp(StaticFiles):
    """Serve index.html for client-side routes (/lab, /real, /home) but never for /api."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        from starlette.exceptions import HTTPException as StarletteHTTPException

        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path.startswith("api"):
                raise
            return await super().get_response("index.html", scope)


if _DIST.is_dir():
    app.mount("/", _SinglePageApp(directory=_DIST, html=True), name="frontend")
