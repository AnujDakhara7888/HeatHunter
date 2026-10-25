"""HeatHunter FastAPI application.

Homes are monitored night after night (API v2, ``monitoring_service.py``);
the Real Homes tab, floor-plan reading and weather lookup are kept alongside.
Errors map to explicit status codes; an unavailable scientific dependency is a
501, never a fabricated success.
"""

from __future__ import annotations

import threading
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Query, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .contracts import (
    AdvanceRequest,
    ApiError,
    ChatReply,
    DemoHomeCreate,
    DemoReveal,
    EvaluationSummary,
    FixRequest,
    FloorPlanDraft,
    HealthResponse,
    HomeChatRequest,
    HomeCreate,
    HomeHealth,
    HomePlan,
    HomeReadings,
    HomeSummary,
    ReadingsUpload,
    RealHouse,
    RoomReport,
    RoomTechnical,
    Series,
    WeatherLookup,
)
from .runtime import REPOSITORY_ROOT, load_evaluation_summary

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
        status.HTTP_404_NOT_FOUND: "Unknown home, room or asset.",
        status.HTTP_409_CONFLICT: "The action is not valid for this home now.",
        status.HTTP_422_UNPROCESSABLE_CONTENT: "The request is invalid.",
        status.HTTP_501_NOT_IMPLEMENTED: "The owning scientific or data service is not available.",
        status.HTTP_503_SERVICE_UNAVAILABLE: "An optional online service (Claude, weather) is unavailable.",
    }
    return {code: {"model": ApiError, "description": descriptions[code]} for code in codes}


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


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse()


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


@app.get("/api/homes/sample-plan", response_model=HomePlan, tags=["homes"])
async def sample_plan() -> HomePlan:
    """The documented HH09 plan, in the same format a user's plan uses."""

    return HomePlan.model_validate_json((REPOSITORY_ROOT / "shared" / "homes" / "hh09_plan.json").read_text())


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


def _timeline_wind_direction(night_id: str) -> Series:
    """Wind direction for a monitoring night, sliced from the consecutive-season timeline."""

    from datetime import date

    from backend.data_pipeline.weather_timeline import TimelineError, _night_slice, load_season

    try:
        night_date = date.fromisoformat(night_id.removeprefix("hh09-night-"))
    except ValueError as exc:
        raise ApiFailure(422, "INVALID_REQUEST", "night_id must end with an ISO date") from exc
    for split in ("heldout", "training"):
        try:
            payload = load_season(split)
            times, index = _night_slice(payload, night_date)
        except (TimelineError, FileNotFoundError):
            continue
        values = payload["wind_direction_deg_from_north"][index : index + len(times)]
        return Series(
            timestamps=times, values=values, unit="degrees_from_north", provenance="REAL_MEASUREMENT"
        )
    raise ApiFailure(404, "NOT_FOUND", f"no wind direction for {night_id}")


@app.get(
    "/api/weather/{night_id}/wind-direction",
    response_model=Series,
    responses=_errors(404, 422),
    tags=["homes"],
)
async def wind_direction(night_id: str) -> Series:
    """Measured wind direction (degrees from north) for an HH09-region weather night.

    Kept outside ``WeatherNight`` (frozen contract); read from Anuj's companion cache.
    """

    from backend.data_pipeline.weather import load_weather_wind_direction

    if night_id.startswith("hh09-night-"):
        return _timeline_wind_direction(night_id)
    try:
        payload = load_weather_wind_direction(night_id)
    except FileNotFoundError as exc:
        raise ApiFailure(404, "NOT_FOUND", str(exc)) from exc
    except ValueError as exc:
        raise ApiFailure(422, "INVALID_REQUEST", str(exc)) from exc
    return Series.model_validate(payload["wind_direction"])


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


@app.post("/api/assistant/chat", response_model=ChatReply, responses=V2_ERRORS, tags=["assistant"])
async def site_assistant(request: HomeChatRequest) -> ChatReply:
    """Chat when no home is on screen: questions about HeatHunter itself; Claude only."""

    from .assistant import AssistantUnavailable, site_chat

    try:
        return await run_in_threadpool(site_chat, request.messages)
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
