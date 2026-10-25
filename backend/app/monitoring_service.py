"""Homes monitored night after night: the API v2 service (integration layer).

Demo homes (the simulated HH09 twin with a hidden fault) and real homes (a
user's plan and sensor readings) share one model. After every new
heating-off night, each room is re-scored with the tuned multi-night flag rule
(``backend.diagnosis.monitoring``) on its latest nights, at most
``FIT_WINDOW_NIGHTS`` (the range the rule was tuned on). Rooms are scored in
parallel worker processes, because a 14-night fit takes seconds.

A reported fix starts a fresh evidence window for that room: only nights from
the fix onward are judged. The room is ``resolved`` once the latest
``persistence_nights`` of them are healthy, and ``still_an_issue`` if the rule
flags it again. For a demo home, the fix also changes the simulated house,
because the user is playing the person doing the repair.

Hidden truth stays inside ``backend.simulation.demo_home.DemoHome``; this
module reads it only in ``reveal``.
"""

from __future__ import annotations

import os
import secrets
import threading
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime
from uuid import uuid4

from backend.diagnosis.monitoring import (
    MonitoringSettings,
    NightScore,
    load_monitoring_settings,
    room_status,
    score_room,
)
from backend.engine import (
    MoneyOverrides,
    PublicModelEngine,
    estimate_money,
    fit_hypothesis_detailed,
    load_model_extension,
    load_public_template,
)
from backend.engine.assumptions import load_assumptions, value
from backend.engine.fitting import FitSettings
from backend.engine.model import ModelExtension

from .contracts import (
    Assumption,
    DemoHomeCreate,
    DemoReveal,
    FaultType,
    FixAction,
    FixRecord,
    FixRequest,
    HomeCreate,
    HomeHealth,
    HomeHistory,
    HomeKind,
    HomeReadings,
    HomeStatus,
    HomeSummary,
    HomeTemplate,
    HypothesisSummary,
    HypothesisType,
    Location,
    NightEvidence,
    NightInfo,
    NightObservations,
    Provenance,
    PublicTemplate,
    ReadingsUpload,
    RoomHealthView,
    RoomHistory,
    RoomMoney,
    RoomNightSnapshot,
    RoomReadings,
    RoomReport,
    RoomStatus,
    RoomTechnical,
    Series,
)
from .homes import build_home, geocode, hh09_exposed_m2, plan_insulation, surface_insulation
from .insight import predicted_series
from .real_homes import (
    HOMES_DIR,
    RealHomeRecord,
    build_night,
    complete_nights,
    load_homes,
    merge_readings,
    save_home,
)

FIT_WINDOW_NIGHTS = 14
MAX_DEMO_HOMES = 32
DISCLAIMER = (
    "Screening estimate from an approximate physics model, not a certified energy audit. "
    "The flag rule was tuned on simulated homes; it has not been validated on real homes."
)
CAUSE_PHRASE = {
    HypothesisType.DRAFT: "through air leaks (draughts)",
    HypothesisType.ENVELOPE_CONDUCTION: "through the walls, roof or floor",
}
WHAT_TO_DO = {
    HypothesisType.DRAFT: [
        "Check the seals around windows and external doors; replace worn draught strips.",
        "Look for gaps around pipes, cables, the loft hatch, skirting boards and any chimney.",
        "Seal gaps with draught-proofing strips, caulk or foam, "
        "but keep trickle vents and extractor fans working.",
    ],
    HypothesisType.ENVELOPE_CONDUCTION: [
        "Check how deep the loft insulation is; thin or missing insulation is a common cause.",
        "Ask an installer whether the walls are insulated (cavity or solid-wall insulation).",
        "Cold or damp patches on a wall often show where insulation is missing.",
    ],
}
FAN_CHECK = (
    "Optional check: on a calm night, close the internal doors and run a kitchen or bathroom "
    "extractor fan for 2 hours. If this room cools noticeably faster than usual, an air leak is "
    "likely. Do not do this if the home has an open-flued gas, oil or solid-fuel appliance."
)
ISSUE_STATUSES = {RoomStatus.ISSUE, RoomStatus.ISSUE_CAUSE_UNCLEAR, RoomStatus.STILL_AN_ISSUE}


class HomeStateError(RuntimeError):
    """The action is not valid for this home now (maps to HTTP 409)."""


# --- parallel scoring ----------------------------------------------------------

_pool: ProcessPoolExecutor | None = None
_pool_lock = threading.Lock()


def _executor() -> ProcessPoolExecutor | None:
    global _pool
    workers = int(os.environ.get("HEATHUNTER_FIT_WORKERS", min(4, os.cpu_count() or 1)))
    if workers <= 1:
        return None
    with _pool_lock:
        if _pool is None:
            _pool = ProcessPoolExecutor(max_workers=workers)
        return _pool


def _score_job(
    nights: list[NightObservations],
    room_id: str,
    template: PublicTemplate,
    settings: MonitoringSettings,
    extension: ModelExtension | None,
) -> NightScore:
    return score_room(nights, room_id, template, settings, PublicModelEngine(extension=extension), extension)


def _expected_job(
    nights: list[NightObservations],
    room_id: str,
    template: PublicTemplate,
    extension: ModelExtension | None,
) -> dict[str, Series]:
    settings = FitSettings()
    detail = fit_hypothesis_detailed(nights, room_id, template, HypothesisType.NORMAL, settings, extension)
    return predicted_series(nights, template, room_id, HypothesisType.NORMAL, detail, settings, extension)


def _run(jobs: list[tuple]) -> list:
    pool = _executor()
    if pool is None or len(jobs) < 2:
        return [function(*args) for function, *args in jobs]
    futures = [pool.submit(function, *args) for function, *args in jobs]
    return [future.result() for future in futures]


# --- state ---------------------------------------------------------------------


@dataclass
class FixState:
    action: FixAction
    reported_at: datetime
    fixed_on: date | None
    note: str | None
    first_night: date  # first night judged after the fix
    found_before: str | None

    def to_json(self) -> dict:
        return {
            "action": self.action.value,
            "reported_at": self.reported_at.isoformat(),
            "fixed_on": self.fixed_on.isoformat() if self.fixed_on else None,
            "note": self.note,
            "first_night": self.first_night.isoformat(),
            "found_before": self.found_before,
        }

    @classmethod
    def from_json(cls, payload: dict) -> FixState:
        return cls(
            action=FixAction(payload["action"]),
            reported_at=datetime.fromisoformat(payload["reported_at"]),
            fixed_on=date.fromisoformat(payload["fixed_on"]) if payload.get("fixed_on") else None,
            note=payload.get("note"),
            first_night=date.fromisoformat(payload["first_night"]),
            found_before=payload.get("found_before"),
        )


@dataclass
class RoomTrack:
    history: list[NightScore] = field(default_factory=list)  # scores after 1, 2, ... judged nights
    judged_ids: list[str] = field(default_factory=list)
    timeline: list[tuple[int, RoomStatus, HypothesisType | None, bool]] = field(default_factory=list)
    # (night id, scores so far, status) after every scored night; unlike history, kept across a fix
    snapshots: list[tuple[str, NightScore, RoomStatus, bool]] = field(default_factory=list)
    fix: FixState | None = None


@dataclass
class HomeState:
    home_id: str
    name: str
    kind: HomeKind
    created_at: datetime
    template: PublicTemplate
    extension: ModelExtension | None
    settings: MonitoringSettings
    room_names: dict[str, str]
    nights: list[NightObservations] = field(default_factory=list)
    tracks: dict[str, RoomTrack] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)
    demo: object | None = None  # backend.simulation.demo_home.DemoHome, never inspected here
    revealed: bool = False
    record: RealHomeRecord | None = None
    home_template: HomeTemplate | None = None
    readings_cache: tuple[tuple, dict[str, dict[str, Series]]] | None = None

    def judged_nights(self, room_id: str) -> list[NightObservations]:
        fix = self.tracks[room_id].fix
        if fix is None:
            return self.nights
        return [
            n
            for n in self.nights
            if n.weather.local_night_date and n.weather.local_night_date >= fix.first_night
        ]


def _night_info(night: NightObservations) -> NightInfo:
    weather = night.weather
    return NightInfo(
        night_id=night.night_id,
        start=weather.outdoor_temperature.timestamps[0],
        end=weather.outdoor_temperature.timestamps[-1],
        mean_outdoor_c=round(
            sum(weather.outdoor_temperature.values) / len(weather.outdoor_temperature.values), 2
        ),
        mean_wind_m_s=round(sum(weather.wind_speed.values) / len(weather.wind_speed.values), 2),
    )


def _night_date(night: NightObservations) -> date:
    return night.weather.local_night_date or night.weather.outdoor_temperature.timestamps[0].date()


class HomeService:
    """All homes. Thread-safe; numerical work should be called from a worker thread."""

    def __init__(self, *, homes_dir=HOMES_DIR) -> None:
        self._demo_template = load_public_template()
        self._demo_extension = load_model_extension()
        self._settings = load_monitoring_settings(template_id=self._demo_template.template_id)
        self._homes_dir = homes_dir
        self._homes: dict[str, HomeState] = {}
        self._lock = threading.RLock()
        for record in load_homes(homes_dir):
            self._homes[record.home_id] = self._real_state(record)

    # --- creation ---------------------------------------------------------------

    def create_demo(self, request: DemoHomeCreate) -> HomeSummary:
        from backend.simulation.demo_home import DemoHome
        from backend.simulation.physics import Fault

        fault = (
            Fault(FaultType(request.fault.type), request.fault.room_id, request.fault.severity)
            if request.fault
            else None
        )
        demo = DemoHome(
            seed=request.seed if request.seed is not None else secrets.randbelow(2**63),
            fault=fault,
            random_fault=request.random_fault,
            start_date=request.start_date,
        )
        state = HomeState(
            home_id=f"demo-{uuid4().hex[:10]}",
            name="HH09 twin (demo)",
            kind=HomeKind.DEMO,
            created_at=datetime.now(UTC),
            template=self._demo_template,
            extension=self._demo_extension,
            settings=self._settings,
            room_names={r.room_id: r.room_name for r in self._demo_template.rooms},
            tracks={r.room_id: RoomTrack() for r in self._demo_template.rooms},
            demo=demo,
        )
        with self._lock:
            demos = sorted(
                (h for h in self._homes.values() if h.kind == HomeKind.DEMO), key=lambda h: h.created_at
            )
            for stale in demos[: max(0, len(demos) - MAX_DEMO_HOMES + 1)]:
                del self._homes[stale.home_id]
            self._homes[state.home_id] = state
        return self._summary(state)

    def create_real(self, request: HomeCreate) -> HomeSummary:
        location = (
            Location(
                name=request.location_query or "Home",
                latitude=request.latitude,
                longitude=request.longitude,
                timezone=request.heating_off.timezone,
            )
            if request.latitude is not None
            else geocode(request.location_query)
        )
        record = RealHomeRecord(
            home_id=f"home-{uuid4().hex[:10]}",
            name=request.name,
            created_at=datetime.now(UTC),
            plan=request.plan,
            location=location,
            heating_off=request.heating_off,
        )
        state = self._real_state(record)
        save_home(record, self._homes_dir)
        with self._lock:
            self._homes[state.home_id] = state
        return self._summary(state)

    def _real_state(self, record: RealHomeRecord) -> HomeState:
        home_template, extension = build_home(record.plan)
        template = home_template.template
        settings = replace(
            self._settings,
            template_id=template.template_id,
            provenance=self._settings.provenance
            + " Transferred unchanged to this home from the HH09-twin tuning (ASSUMPTION).",
        )
        tracks = {r.room_id: RoomTrack() for r in template.rooms}
        for room_id, fix in record.fixes.items():
            if room_id in tracks:
                tracks[room_id].fix = FixState.from_json(fix)
        return HomeState(
            home_id=record.home_id,
            name=record.name,
            kind=HomeKind.REAL,
            created_at=record.created_at,
            template=template,
            extension=extension,
            settings=settings,
            room_names={r.room_id: r.room_name for r in template.rooms},
            tracks=tracks,
            record=record,
            home_template=home_template,
        )

    # --- lookup -----------------------------------------------------------------

    def _get(self, home_id: str) -> HomeState:
        with self._lock:
            state = self._homes.get(home_id)
        if state is None:
            raise KeyError(f"unknown home {home_id!r}")
        return state

    def _room(self, state: HomeState, room_id: str) -> RoomTrack:
        if room_id not in state.tracks:
            raise KeyError(f"unknown room {room_id!r} in {state.home_id}")
        return state.tracks[room_id]

    def list_homes(self) -> list[HomeSummary]:
        with self._lock:
            states = sorted(self._homes.values(), key=lambda h: h.created_at, reverse=True)
        return [self._summary(state) for state in states]

    # --- nights and scoring -------------------------------------------------------

    def _sync_real_nights(self, state: HomeState) -> None:
        sensed = [r.room_id for r in state.template.rooms]
        windows = complete_nights(state.record, sensed)
        known = {n.night_id for n in state.nights}
        new = [
            build_night(state.record, sensed, day, start, end)
            for day, start, end in windows
            if f"{state.home_id}-{day.isoformat()}" not in known
        ]
        if not new:
            return
        save_home(state.record, self._homes_dir)  # newly fetched weather is cached
        merged = sorted([*state.nights, *new], key=_night_date)
        if state.nights and _night_date(new[0]) < _night_date(state.nights[-1]):
            for track in state.tracks.values():  # an earlier night arrived late: rescore from scratch
                track.history.clear()
                track.judged_ids.clear()
                track.timeline.clear()
                track.snapshots.clear()
        state.nights = merged

    def _refresh(self, state: HomeState) -> None:
        """Score every room on each judged night it has not been scored on yet."""

        jobs, keys = [], []
        for room_id, track in state.tracks.items():
            judged = state.judged_nights(room_id)
            for count in range(len(track.history) + 1, len(judged) + 1):
                window = judged[max(0, count - FIT_WINDOW_NIGHTS) : count]
                jobs.append((_score_job, window, room_id, state.template, state.settings, state.extension))
                keys.append((room_id, judged[count - 1].night_id))
        position = {night.night_id: index + 1 for index, night in enumerate(state.nights)}
        for (room_id, night_id), score in zip(keys, _run(jobs), strict=True):
            track = state.tracks[room_id]
            track.history.append(score)
            track.judged_ids.append(night_id)
            status, _ = self._status(state, room_id)
            track.timeline.append(
                (position[night_id], status, self._named(track, status), track.fix is not None)
            )
            track.snapshots.append((night_id, score, status, track.fix is not None))

    def _ensure_current(self, state: HomeState) -> None:
        with state.lock:
            if state.kind == HomeKind.REAL:
                self._sync_real_nights(state)
            self._refresh(state)

    # --- status ---------------------------------------------------------------

    def _status(self, state: HomeState, room_id: str) -> tuple[RoomStatus, int]:
        track = state.tracks[room_id]
        if not track.history:
            return (RoomStatus.VERIFYING if track.fix else RoomStatus.NOT_ENOUGH_DATA), 0
        status, streak = room_status(track.history, state.settings)
        if track.fix is None:
            return RoomStatus(status), streak
        if status in {"issue", "issue_cause_unclear"}:
            return RoomStatus.STILL_AN_ISSUE, streak
        recent = track.history[-state.settings.persistence_nights :]
        if len(recent) == state.settings.persistence_nights and not any(s.candidate for s in recent):
            return RoomStatus.RESOLVED, streak
        return RoomStatus.VERIFYING, streak

    @staticmethod
    def _named(track: RoomTrack, status: RoomStatus) -> HypothesisType | None:
        if status in {RoomStatus.ISSUE, RoomStatus.STILL_AN_ISSUE} and track.history:
            return track.history[-1].leading_cause
        return None

    def _likely(self, state: HomeState, room_id: str, status: RoomStatus) -> HypothesisType | None:
        track = state.tracks[room_id]
        if status == RoomStatus.STILL_AN_ISSUE:
            gap = track.history[-1].cause_gap_bic
            return track.history[-1].leading_cause if gap > state.settings.cause_gap_bic else None
        return self._named(track, status)

    def _summary(self, state: HomeState) -> HomeSummary:
        statuses = [self._status(state, room)[0] for room in state.tracks]
        issues = sum(s in ISSUE_STATUSES for s in statuses)
        if issues:
            home_status = HomeStatus.ISSUE
        elif RoomStatus.VERIFYING in statuses:
            home_status = HomeStatus.VERIFYING
        elif len(state.nights) >= state.settings.persistence_nights and all(
            s in {RoomStatus.HEALTHY, RoomStatus.RESOLVED} for s in statuses
        ):
            home_status = HomeStatus.ALL_CLEAR
        else:
            home_status = HomeStatus.MONITORING
        return HomeSummary(
            home_id=state.home_id,
            name=state.name,
            kind=state.kind,
            status=home_status,
            rooms_with_issues=issues,
            nights_monitored=len(state.nights),
            last_night=_night_date(state.nights[-1]) if state.nights else None,
            created_at=state.created_at,
        )

    # --- money and words --------------------------------------------------------

    def _money(
        self, state: HomeState, room_id: str, named: HypothesisType | None, score: NightScore | None = None
    ) -> RoomMoney | None:
        score = score or state.tracks[room_id].history[-1]
        fit = score.fits[score.leading_cause]
        overrides = None
        if state.kind == HomeKind.REAL and named is not None:
            assumptions = load_assumptions()
            if named == HypothesisType.DRAFT:
                repair = float(assumptions["economic"]["repair_costs"]["seal_leaks"]["value"])
            else:
                rate = float(assumptions["economic"]["repair_costs"]["add_insulation"]["value"])
                wall = (
                    state.home_template.exterior_wall_length_m.get(room_id, 0.0)
                    * state.record.plan.ceiling_height_m
                )
                repair = rate * max(wall - state.home_template.window_area_m2.get(room_id, 0.0), 0.0)
            overrides = MoneyOverrides(repair_cost_gbp=repair)
        estimate = estimate_money(
            state.template, room_id, fit, extension=state.extension, overrides=overrides
        )
        if estimate is None:
            return None
        fx = value(load_assumptions(), "economic", "gbp_to_usd")
        return RoomMoney(
            annual_cost_gbp=round(estimate.annual_cost_estimate_usd / fx, 2),
            annual_energy_kwh=round(estimate.annual_energy_estimate_kwh, 1),
            repair_cost_gbp=round(estimate.repair_cost_usd / fx, 2) if named else None,
            payback_years=(
                round(estimate.simple_payback_years, 1) if named and estimate.simple_payback_years else None
            ),
            assumptions=estimate.assumptions,
        )

    @staticmethod
    def _percent(fraction: float) -> int:
        return int(round(max(fraction, 0.0) * 100 / 5) * 5)

    def _headline(self, state: HomeState, room_id: str, status: RoomStatus) -> str:
        track = state.tracks[room_id]
        name = state.room_names[room_id]
        if status == RoomStatus.NOT_ENOUGH_DATA:
            return "Waiting for the first heating-off night."
        if status == RoomStatus.HEALTHY:
            return "Behaving as expected."
        latest = track.history[-1] if track.history else None
        percent = self._percent(latest.excess_fraction) if latest else 0
        if status == RoomStatus.WATCHING:
            return f"{name} cooled faster than expected last night; checking again on the next night."
        if status == RoomStatus.ISSUE:
            cause = CAUSE_PHRASE[latest.leading_cause]
            return f"Losing about {percent}% more heat than expected, most likely {cause}."
        if status == RoomStatus.ISSUE_CAUSE_UNCLEAR:
            return f"Losing about {percent}% more heat than expected; the cause is not clear yet."
        if status == RoomStatus.VERIFYING:
            checked = len(track.history)
            needed = state.settings.persistence_nights
            return f"Fix reported; {checked} of {needed} nights since the fix checked."
        if status == RoomStatus.RESOLVED:
            return "Fixed: since the repair this room cools as expected."
        return f"Still losing about {percent}% more heat than expected after the fix."

    def _why(self, state: HomeState, room_id: str, status: RoomStatus, streak: int) -> list[str]:
        track = state.tracks[room_id]
        name = state.room_names[room_id].lower()
        if not track.history:
            return []
        latest = track.history[-1]
        judged = len(track.history)
        if status in {RoomStatus.HEALTHY, RoomStatus.RESOLVED}:
            since = " since the fix" if track.fix else ""
            return [
                f"Over {judged} night{'s' * (judged != 1)}{since} it cooled the way a healthy {name} should."
            ]
        lines = [
            f"Judging {min(judged, FIT_WINDOW_NIGHTS)} nights{' since the fix' if track.fix else ''}, "
            f"it loses about {round(latest.excess_fraction * 100)}% more heat than a healthy {name} "
            "should; the alarm level at "
            f"this point is {round(latest.threshold * 100)}%."
        ]
        if status == RoomStatus.WATCHING:
            lines.append(
                "Only the latest night is above that level; one more night is needed before we flag it."
            )
            return lines
        lines.append(f"It has stayed above that level for {streak} nights in a row.")
        winds = [
            n.weather.selection_metadata.mean_wind_speed_m_s
            if n.weather.selection_metadata
            else sum(n.weather.wind_speed.values) / len(n.weather.wind_speed.values)
            for n in state.judged_nights(room_id)[-FIT_WINDOW_NIGHTS:]
        ]
        if latest.cause_gap_bic > state.settings.cause_gap_bic:
            other = "wall heat loss" if latest.leading_cause == HypothesisType.DRAFT else "an air leak"
            leading = (
                "An air leak"
                if latest.leading_cause == HypothesisType.DRAFT
                else "Heat escaping through the walls, roof or floor"
            )
            lines.append(
                f"{leading} explains how it cooled on calm and windy nights better than {other} does."
            )
        else:
            lines.append(
                "An air leak and wall heat loss explain the nights about equally well so far; "
                "nights with different wind will tell them apart."
            )
        lines.append(f"Average winds on those nights ranged from {min(winds):.1f} to {max(winds):.1f} m/s.")
        if status == RoomStatus.STILL_AN_ISSUE:
            lines.insert(0, "The reported fix has not removed the extra heat loss.")
        return lines

    def _health_view(self, state: HomeState, room_id: str) -> RoomHealthView:
        status, _ = self._status(state, room_id)
        track = state.tracks[room_id]
        issue = status in ISSUE_STATUSES
        money = self._money(state, room_id, self._likely(state, room_id, status)) if issue else None
        likely = self._likely(state, room_id, status)
        return RoomHealthView(
            room_id=room_id,
            name=state.room_names[room_id],
            status=status,
            headline=self._headline(state, room_id, status),
            likely_cause=likely.value if likely else None,
            extra_heat_loss_percent=self._percent(track.history[-1].excess_fraction) if issue else None,
            annual_cost_gbp=money.annual_cost_gbp if money else None,
            nights_seen=len(track.history),
        )

    # --- public operations -------------------------------------------------------

    def health(self, home_id: str) -> HomeHealth:
        state = self._get(home_id)
        self._ensure_current(state)
        with state.lock:
            return HomeHealth(
                home=self._summary(state),
                rooms=[self._health_view(state, room_id) for room_id in state.tracks],
                disclaimer=DISCLAIMER,
            )

    def advance(self, home_id: str, nights: int) -> HomeHealth:
        state = self._get(home_id)
        if state.kind != HomeKind.DEMO:
            raise HomeStateError("only demo homes have a simulated clock; real homes advance with uploads")
        with state.lock:
            try:
                new = state.demo.next_nights(nights)
            except ValueError as exc:
                raise HomeStateError(str(exc)) from exc
            state.nights.extend(new)
            state.readings_cache = None
            self._refresh(state)
        return self.health(home_id)

    def upload(self, home_id: str, upload: ReadingsUpload) -> HomeHealth:
        state = self._get(home_id)
        if state.kind != HomeKind.REAL:
            raise HomeStateError("demo homes are simulated; use advance instead of uploading readings")
        with state.lock:
            merge_readings(state.record, upload.room_temperature_series, set(state.tracks))
            save_home(state.record, self._homes_dir)
            state.readings_cache = None
        return self.health(home_id)

    def room_report(self, home_id: str, room_id: str) -> RoomReport:
        state = self._get(home_id)
        self._ensure_current(state)
        with state.lock:
            track = self._room(state, room_id)
            status, streak = self._status(state, room_id)
            likely = self._likely(state, room_id, status)
            money = self._money(state, room_id, likely) if status in ISSUE_STATUSES else None
            what = []
            if status in ISSUE_STATUSES:
                what = (
                    WHAT_TO_DO[likely]
                    if likely
                    else [
                        "Wait a few more nights: windy nights help tell an air leak from wall heat loss.",
                        *WHAT_TO_DO[HypothesisType.DRAFT][:1],
                        *WHAT_TO_DO[HypothesisType.ENVELOPE_CONDUCTION][:1],
                    ]
                )
            judged = {n.night_id: n for n in state.judged_nights(room_id)}
            evidence = [
                NightEvidence(
                    night_id=night_id,
                    nights_so_far=index + 1,
                    extra_heat_loss_percent=round(score.excess_fraction * 100, 1),
                    threshold_percent=round(score.threshold * 100, 1),
                    leading_cause=score.leading_cause.value,
                    mean_wind_m_s=round(
                        sum(judged[night_id].weather.wind_speed.values)
                        / len(judged[night_id].weather.wind_speed.values),
                        2,
                    ),
                )
                for index, (night_id, score) in enumerate(zip(track.judged_ids, track.history, strict=True))
                if night_id in judged
            ]
            fix = None
            if track.fix:
                fix = FixRecord(
                    action=track.fix.action,
                    reported_at=track.fix.reported_at,
                    fixed_on=track.fix.fixed_on,
                    note=track.fix.note,
                    nights_since_fix=len(track.history),
                    found_before_fix=track.fix.found_before,
                )
            return RoomReport(
                room_id=room_id,
                name=state.room_names[room_id],
                status=status,
                headline=self._headline(state, room_id, status),
                why=self._why(state, room_id, status, streak),
                what_to_do=what,
                money=money,
                evidence_by_night=evidence,
                suggested_check=FAN_CHECK if status == RoomStatus.ISSUE_CAUSE_UNCLEAR else None,
                fix=fix,
            )

    def room_technical(self, home_id: str, room_id: str) -> RoomTechnical:
        state = self._get(home_id)
        self._ensure_current(state)
        with state.lock:
            track = self._room(state, room_id)
            _, streak = self._status(state, room_id)
            latest = track.history[-1] if track.history else None
            s = state.settings
            rule = [
                Assumption(
                    name="draft_threshold",
                    value=f"{s.draft_a} + {s.draft_b}/sqrt(nights)",
                    unit="fraction of nominal heat loss",
                ),
                Assumption(
                    name="envelope_threshold",
                    value=f"{s.envelope_a} + {s.envelope_b}/sqrt(nights)",
                    unit="fraction of nominal heat loss",
                ),
                Assumption(name="persistence_nights", value=s.persistence_nights, unit="nights"),
                Assumption(name="cause_gap", value=s.cause_gap_bic, unit="BIC"),
                Assumption(name="fit_window", value=FIT_WINDOW_NIGHTS, unit="nights"),
                Assumption(name="rule_provenance", value=s.provenance),
            ]
            return RoomTechnical(
                room_id=room_id,
                nights_judged=min(len(track.history), FIT_WINDOW_NIGHTS),
                fits=[
                    HypothesisSummary(
                        fault_type=cause,
                        fitted_multiplier=fit.fitted_multiplier,
                        bic=fit.bic,
                        residual_rmse_deg_c=fit.residual_rmse_deg_c,
                    )
                    for cause, fit in (latest.fits.items() if latest else [])
                ],
                leading_cause=latest.leading_cause.value if latest else None,
                extra_heat_loss_fraction=latest.excess_fraction if latest else None,
                threshold_fraction=latest.threshold if latest else None,
                cause_gap_bic=latest.cause_gap_bic if latest else None,
                consecutive_candidate_nights=streak,
                rule=rule,
            )

    def history(self, home_id: str) -> HomeHistory:
        """Each room's status after every night, read from the scores already made (no refitting)."""

        state = self._get(home_id)
        self._ensure_current(state)
        with state.lock:
            position = {night.night_id: index + 1 for index, night in enumerate(state.nights)}
            rooms = []
            for room_id, track in state.tracks.items():
                snapshots = []
                for night_id, score, status, after_fix in track.snapshots:
                    named = (
                        score.leading_cause
                        if status in {RoomStatus.ISSUE, RoomStatus.STILL_AN_ISSUE}
                        else None
                    )
                    money = self._money(state, room_id, named, score) if status in ISSUE_STATUSES else None
                    snapshots.append(
                        RoomNightSnapshot(
                            night_id=night_id,
                            night_number=position[night_id],
                            nights_judged=score.nights,
                            after_fix=after_fix,
                            status=status,
                            named_cause=named.value if named else None,
                            leading_cause=score.leading_cause.value,
                            extra_heat_loss_percent=round(score.excess_fraction * 100, 1),
                            threshold_percent=round(score.threshold * 100, 1),
                            cause_gap_bic=round(score.cause_gap_bic, 2),
                            candidate=score.candidate,
                            fits=[
                                HypothesisSummary(
                                    fault_type=cause,
                                    fitted_multiplier=fit.fitted_multiplier,
                                    bic=fit.bic,
                                    residual_rmse_deg_c=fit.residual_rmse_deg_c,
                                )
                                for cause, fit in score.fits.items()
                            ],
                            annual_cost_gbp=money.annual_cost_gbp if money else None,
                        )
                    )
                rooms.append(
                    RoomHistory(
                        room_id=room_id,
                        name=state.room_names[room_id],
                        snapshots=snapshots,
                        fix_action=track.fix.action if track.fix else None,
                    )
                )
            return HomeHistory(
                home_id=home_id,
                nights=[_night_info(n) for n in state.nights],
                rooms=rooms,
                persistence_nights=state.settings.persistence_nights,
                cause_gap_bic=state.settings.cause_gap_bic,
                advice={cause.value: lines for cause, lines in WHAT_TO_DO.items()},
            )

    def report_fix(self, home_id: str, room_id: str, request: FixRequest) -> RoomReport:
        state = self._get(home_id)
        self._ensure_current(state)
        with state.lock:
            track = self._room(state, room_id)
            status, _ = self._status(state, room_id)
            before = None
            if status in ISSUE_STATUSES:
                likely = self._likely(state, room_id, status)
                before = likely.value if likely else "unclear"
            if state.kind == HomeKind.DEMO:
                first = state.demo.next_night_date
                if first is None:
                    raise HomeStateError("the demo has no nights left to check a fix")
                state.demo.apply_manual_fix(room_id, request.action.value)
            else:
                first = request.fixed_on or datetime.now(UTC).date()
                if state.nights and first <= _night_date(state.nights[-1]) and request.fixed_on is None:
                    first = _night_date(state.nights[-1])
            track.fix = FixState(
                action=request.action,
                reported_at=datetime.now(UTC),
                fixed_on=request.fixed_on,
                note=request.note,
                first_night=first,
                found_before=before,
            )
            track.history.clear()
            track.judged_ids.clear()
            if state.kind == HomeKind.REAL:
                state.record.fixes[room_id] = track.fix.to_json()
                save_home(state.record, self._homes_dir)
            state.readings_cache = None
        return self.room_report(home_id, room_id)

    def readings(
        self,
        home_id: str,
        start: datetime | None = None,
        end: datetime | None = None,
        room_id: str | None = None,
    ) -> HomeReadings:
        state = self._get(home_id)
        self._ensure_current(state)
        with state.lock:
            if room_id:
                self._room(state, room_id)
            rooms = [room_id] if room_id else list(state.tracks)
            key = (
                len(state.nights),
                tuple((r, t.fix.first_night if t.fix else None) for r, t in state.tracks.items()),
            )
            if state.readings_cache is None or state.readings_cache[0] != key:
                jobs = [
                    (
                        _expected_job,
                        state.judged_nights(r)[-FIT_WINDOW_NIGHTS:],
                        r,
                        state.template,
                        state.extension,
                    )
                    for r in state.tracks
                    if state.judged_nights(r)
                ]
                fitted = [r for r in state.tracks if state.judged_nights(r)]
                state.readings_cache = (key, dict(zip(fitted, _run(jobs), strict=True)))
            expected = state.readings_cache[1]
            nights = [
                n
                for n in state.nights
                if (start is None or n.weather.outdoor_temperature.timestamps[-1] >= start)
                and (end is None or n.weather.outdoor_temperature.timestamps[0] <= end)
            ]
            if not nights:
                raise HomeStateError("no recorded nights in that period")

            def joined(series: Sequence[Series], provenance: Provenance, unit: str) -> Series:
                return Series(
                    timestamps=[t for s in series for t in s.timestamps],
                    values=[v for s in series for v in s.values],
                    unit=unit,
                    provenance=provenance,
                )

            out_rooms = {}
            for r in rooms:
                predicted = [
                    expected[r][n.night_id] for n in nights if r in expected and n.night_id in expected[r]
                ]
                out_rooms[r] = RoomReadings(
                    measured=joined(
                        [n.room_temperature_series[r] for n in nights],
                        nights[0].room_temperature_series[r].provenance,
                        "degC",
                    ),
                    expected_if_healthy=joined(predicted, Provenance.MODEL_ESTIMATE, "degC")
                    if predicted
                    else None,
                )
            return HomeReadings(
                home_id=home_id,
                outdoor_temperature=joined(
                    [n.weather.outdoor_temperature for n in nights],
                    nights[0].weather.outdoor_temperature.provenance,
                    "degC",
                ),
                wind_speed=joined(
                    [n.weather.wind_speed for n in nights], nights[0].weather.wind_speed.provenance, "m/s"
                ),
                insulation=plan_insulation(state.record.plan, state.template, state.extension)
                if state.record is not None
                else surface_insulation(state.template, hh09_exposed_m2(), state.extension),
                rooms=out_rooms,
                nights=[_night_info(n) for n in nights],
            )

    def reveal(self, home_id: str) -> DemoReveal:
        state = self._get(home_id)
        if state.kind != HomeKind.DEMO:
            raise HomeStateError("real homes have no hidden answer to reveal")
        with state.lock:
            if not state.nights:
                raise HomeStateError("advance at least one night before revealing")
            truth = state.demo.reveal()
            before_fix = {
                room: [(n, s, c) for n, s, c, fixed in track.timeline if not fixed]
                for room, track in state.tracks.items()
            }
            if truth.fault_type == FaultType.NONE:
                flagged = sorted(
                    room for room, line in before_fix.items() if any(s in ISSUE_STATUSES for _, s, _ in line)
                )
                found, nights_to_find = not flagged, None
                summary = (
                    "There was no hidden fault, and the app raised no alarm."
                    if found
                    else "There was no hidden fault, but the app flagged: "
                    + ", ".join(state.room_names[r] for r in flagged)
                    + "."
                )
            else:
                hits = [
                    n
                    for n, s, c in before_fix[truth.room_id]
                    if s == RoomStatus.ISSUE and c is not None and c.value == truth.fault_type.value
                ]
                found = bool(hits)
                nights_to_find = hits[0] if hits else None
                cause = "an air leak" if truth.fault_type == FaultType.DRAFT else "wall/roof/floor heat loss"
                where = state.room_names[truth.room_id]
                summary = (
                    f"The hidden fault was {cause} in the {where} ({1 + truth.severity:.1f}x normal). "
                    + (
                        f"The app named it correctly after {nights_to_find} nights."
                        if found
                        else "The app had not named it correctly before any fix."
                    )
                )
            twin = state.demo.fault_free_night(len(state.nights) - 1)
            state.revealed = True
            return DemoReveal(
                fault_type=truth.fault_type,
                room_id=truth.room_id,
                severity=truth.severity,
                app_found_it=found,
                nights_to_find=nights_to_find,
                summary=summary,
                fault_free_twin=dict(twin.room_temperature_series),
                fault_free_night_id=twin.night_id,
            )

    def assistant_context(self, home_id: str) -> dict:
        health = self.health(home_id)
        state = self._get(home_id)
        context = {
            "home": health.model_dump(mode="json"),
            "flagged_rooms": [
                self.room_report(home_id, room.room_id).model_dump(mode="json")
                for room in health.rooms
                if room.status in ISSUE_STATUSES or room.status == RoomStatus.VERIFYING
            ],
            "hidden_answer": "not revealed",
        }
        if state.kind == HomeKind.DEMO and state.revealed:
            truth = state.demo.reveal()
            context["hidden_answer"] = {
                "fault_type": truth.fault_type.value,
                "room_id": truth.room_id,
                "severity_excess_multiplier": truth.severity,
            }
        return context
