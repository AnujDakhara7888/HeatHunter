"""Bring-your-own-home screening (Nikhil, integration layer).

A user's rectangular floor plan becomes a ``PublicTemplate`` by transferring the
HH09 calibration per unit of geometry: envelope conductance per m2 of exposed
envelope, infiltration per m3, air-fabric conductance per m2 of floor, and the
same leakage law. Windows get the engine's air-side glazing path: the SAP
double-glazing U-value x the plan's window area. These are ASSUMPTIONS, disclosed on every response. The
public engine then fits the same three hypotheses to the user's own readings.

Real homes have no verified fault labels, so results are screening only. Homes
are monitored night after night by ``monitoring_service.py``.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np

from backend.engine import load_model_extension, load_public_template
from backend.engine.assumptions import load_assumptions, value
from backend.engine.model import LeakageLaw, ModelExtension

from .contracts import (
    Assumption,
    HomePlan,
    HomeTemplate,
    InterRoomCoupling,
    Location,
    Provenance,
    PublicTemplate,
    RoomTemplate,
    Series,
    SourceMetadata,
    WeatherLookup,
)

HH09_EXPOSED = {  # exterior wall length (m) and floor area (m2) of the calibrated HH09 rooms
    "living_room": (7.51, 13.09),
    "kitchen": (4.97, 5.75),
    "bedroom_1": (6.91, 11.79),
    "bedroom_2": (1.14, 2.72),
}
HH09_CEILING_M = 2.4
WINDOW_HEIGHT_M = 1.2
TOL = 0.05  # m; plan edges closer than this are treated as touching


class HomeError(ValueError):
    """Raised for plans or readings that cannot be screened honestly."""


@lru_cache(maxsize=1)
def unit_coefficients() -> dict[str, float]:
    """Per-geometry coefficients transferred from the calibrated HH09 template."""

    template = load_public_template()
    extension = load_model_extension()
    rooms = {r.room_id: r for r in template.rooms}
    envelope, infiltration, air_fabric = [], [], []
    for room_id, (wall_len, floor) in HH09_EXPOSED.items():
        room = rooms[room_id]
        exposed = wall_len * HH09_CEILING_M + 2 * floor
        envelope.append(room.nominal_envelope_conductance_w_per_k / exposed)
        infiltration.append(room.nominal_infiltration_conductance_w_per_k / room.volume_m3)
        air_fabric.append(extension.air_fabric_conductance_w_per_k[room_id] / floor)
    return {
        "envelope_w_per_m2k": float(np.median(envelope)),
        "infiltration_w_per_m3k": float(np.median(infiltration)),
        "air_fabric_w_per_m2k": float(np.median(air_fabric)),
        "wind_sensitivity_s_per_m": float(template.rooms[0].wind_sensitivity_s_per_m),
        "stack_wind_ratio": extension.leakage_law.stack_wind_ratio,
        "reference_delta_t_k": extension.leakage_law.reference_delta_t_k,
    }


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def plan_geometry(plan: HomePlan) -> tuple[dict[str, float], dict[tuple[str, str], float], dict[str, float]]:
    """Exterior wall length per room, shared wall length per pair, window area per room."""

    rooms = plan.rooms
    for i, a in enumerate(rooms):
        for b in rooms[i + 1 :]:
            if (
                _overlap(a.x, a.x + a.width, b.x, b.x + b.width) > TOL
                and _overlap(a.z, a.z + a.depth, b.z, b.z + b.depth) > TOL
            ):
                raise HomeError(f"rooms {a.name!r} and {b.name!r} overlap")
    perimeter = {r.room_id: 2 * (r.width + r.depth) for r in rooms}
    shared: dict[tuple[str, str], float] = defaultdict(float)
    for i, a in enumerate(rooms):
        for b in rooms[i + 1 :]:
            length = 0.0
            if abs(a.x + a.width - b.x) < TOL or abs(b.x + b.width - a.x) < TOL:
                length += _overlap(a.z, a.z + a.depth, b.z, b.z + b.depth)
            if abs(a.z + a.depth - b.z) < TOL or abs(b.z + b.depth - a.z) < TOL:
                length += _overlap(a.x, a.x + a.width, b.x, b.x + b.width)
            if length > TOL:
                shared[(a.room_id, b.room_id)] = length
    exterior = dict(perimeter)
    for (a, b), length in shared.items():
        exterior[a] -= length
        exterior[b] -= length
    windows: dict[str, float] = defaultdict(float)
    for opening in plan.openings:
        if opening.kind != "window":
            continue
        mx, mz = (opening.x0 + opening.x1) / 2, (opening.z0 + opening.z1) / 2
        length = math.hypot(opening.x1 - opening.x0, opening.z1 - opening.z0)
        nearest = min(
            rooms,
            key=lambda r: min(
                abs(mx - r.x) + max(0, r.z - mz) + max(0, mz - r.z - r.depth),
                abs(mx - r.x - r.width) + max(0, r.z - mz) + max(0, mz - r.z - r.depth),
                abs(mz - r.z) + max(0, r.x - mx) + max(0, mx - r.x - r.width),
                abs(mz - r.z - r.depth) + max(0, r.x - mx) + max(0, mx - r.x - r.width),
            ),
        )
        windows[nearest.room_id] += length * WINDOW_HEIGHT_M
    return {k: max(v, 0.0) for k, v in exterior.items()}, dict(shared), dict(windows)


def build_home(plan: HomePlan) -> tuple[HomeTemplate, ModelExtension]:
    coefficients = unit_coefficients()
    physical = load_assumptions()
    tmp = value(physical, "physical", "thermal_mass_parameter")
    air_c = value(physical, "physical", "air_volumetric_heat_capacity")
    partition_u = value(physical, "physical", "partition_u_value")
    window_u = value(physical, "physical", "window_u_value")
    exterior, shared, windows = plan_geometry(plan)
    h = plan.ceiling_height_m
    rooms, air_fabric = [], {}
    sensed = [r for r in plan.rooms if r.has_sensor]
    if not sensed:
        raise HomeError("at least one room needs a temperature sensor")
    for room in sensed:
        area = room.width * room.depth
        volume = area * h
        exposed = exterior[room.room_id] * h + area * (room.exposed_floor + room.exposed_roof)
        if exposed <= 0:
            exposed = 0.1 * area  # fully interior room: keep a small, explicit path
        rooms.append(
            RoomTemplate(
                room_id=room.room_id,
                room_name=room.name,
                volume_m3=volume,
                nominal_capacitance_j_per_k=tmp * area + air_c * volume,
                nominal_envelope_conductance_w_per_k=coefficients["envelope_w_per_m2k"] * exposed,
                nominal_infiltration_conductance_w_per_k=coefficients["infiltration_w_per_m3k"] * volume,
                wind_sensitivity_s_per_m=coefficients["wind_sensitivity_s_per_m"],
                nominal_leakage_share=0.0,
            )
        )
        air_fabric[room.room_id] = coefficients["air_fabric_w_per_m2k"] * area
    total = sum(r.nominal_infiltration_conductance_w_per_k for r in rooms)
    rooms = [
        r.model_copy(update={"nominal_leakage_share": r.nominal_infiltration_conductance_w_per_k / total})
        for r in rooms
    ]
    ids = {r.room_id for r in rooms}
    couplings = [
        InterRoomCoupling(room_a_id=a, room_b_id=b, conductance_w_per_k=partition_u * length * h)
        for (a, b), length in shared.items()
        if a in ids and b in ids
    ]
    template = PublicTemplate(template_id=f"home-{plan.plan_id}", rooms=rooms, inter_room_couplings=couplings)
    extension = ModelExtension(
        template_id=template.template_id,
        air_fabric_conductance_w_per_k=air_fabric,
        leakage_law=LeakageLaw(coefficients["stack_wind_ratio"], coefficients["reference_delta_t_k"]),
        note="Transferred per unit geometry from the HH09 calibration; windows from the SAP glazing U-value.",
        window_conductance_w_per_k={r.room_id: window_u * windows.get(r.room_id, 0.0) for r in rooms},
    )
    assumptions = [
        Assumption(
            name="envelope_conductance_per_exposed_m2",
            value=coefficients["envelope_w_per_m2k"],
            unit="W/(m2.K)",
            source=_transfer_source(),
        ),
        Assumption(
            name="infiltration_per_m3",
            value=coefficients["infiltration_w_per_m3k"],
            unit="W/(m3.K)",
            source=_transfer_source(),
        ),
        Assumption(
            name="air_fabric_per_floor_m2",
            value=coefficients["air_fabric_w_per_m2k"],
            unit="W/(m2.K)",
            source=_transfer_source(),
        ),
        Assumption(name="thermal_mass_parameter", value=tmp, unit="J/(m2.K)"),
        Assumption(name="partition_u_value", value=partition_u, unit="W/(m2.K)"),
        Assumption(name="window_u_value", value=window_u, unit="W/(m2.K)"),
        Assumption(name="ceiling_height", value=h, unit="m"),
        Assumption(name="window_height", value=WINDOW_HEIGHT_M, unit="m"),
    ]
    home = HomeTemplate(
        template=template,
        exterior_wall_length_m={k: round(v, 3) for k, v in exterior.items()},
        window_area_m2={k: round(v, 3) for k, v in windows.items()},
        assumptions=assumptions,
    )
    return home, extension


def _transfer_source() -> SourceMetadata:
    return SourceMetadata(
        provider="HeatHunter",
        dataset="backend/engine/templates/hh09_public_template.json",
        notes="Median per-unit value of the HH09 calibrated template, transferred to this plan. "
        "Not calibrated on this home.",
    )


def geocode(query: str) -> Location:
    """Find a place by name (Open-Meteo geocoding; needs network)."""

    geo = _get_json(
        "https://geocoding-api.open-meteo.com/v1/search?" + urlencode({"name": query, "count": 1})
    )
    if not geo.get("results"):
        raise HomeError(f"could not find a place called {query!r}")
    place = geo["results"][0]
    return Location(
        name=f"{place['name']}, {place.get('country', '')}".strip(", "),
        latitude=place["latitude"],
        longitude=place["longitude"],
        timezone="UTC",
    )


def lookup_weather(query: str, start: datetime, end: datetime) -> WeatherLookup:
    """Geocode a place and fetch hourly reanalysis weather (Open-Meteo; needs network)."""

    return fetch_weather(geocode(query), start, end)


def fetch_weather(location: Location, start: datetime, end: datetime) -> WeatherLookup:
    """Hourly gridded weather at a location's coordinates (Open-Meteo; needs network)."""

    if location.latitude is None or location.longitude is None:
        raise HomeError("the location has no coordinates")
    params = {
        "latitude": location.latitude,
        "longitude": location.longitude,
        "start_date": (start - timedelta(days=1)).date().isoformat(),
        "end_date": (end + timedelta(days=1)).date().isoformat(),
        "hourly": "temperature_2m,wind_speed_10m",
        "wind_speed_unit": "ms",
        "timezone": "UTC",
    }
    recent = (date.today() - end.date()).days < 6
    host = (
        "https://api.open-meteo.com/v1/forecast?"
        if recent
        else "https://archive-api.open-meteo.com/v1/archive?"
    )
    if recent:
        params.pop("start_date"), params.pop("end_date")
        params["past_days"] = 14
    data = _get_json(host + urlencode(params))
    hourly = data["hourly"]
    stamps = [datetime.fromisoformat(t).replace(tzinfo=UTC) for t in hourly["time"]]
    keep = [
        i
        for i, t in enumerate(stamps)
        if start - timedelta(hours=2) <= t <= end + timedelta(hours=2)
        and hourly["temperature_2m"][i] is not None
    ]
    if len(keep) < 3:
        raise HomeError("no weather available for those dates")
    source = SourceMetadata(
        provider="Open-Meteo",
        dataset="Hourly reanalysis / forecast archive",
        url="https://open-meteo.com/",
        notes="Gridded model weather, not a station reading.",
    )
    return WeatherLookup(
        location=location,
        outdoor_temperature=Series(
            timestamps=[stamps[i] for i in keep],
            values=[hourly["temperature_2m"][i] for i in keep],
            unit="degC",
            provenance=Provenance.MODEL_ESTIMATE,
        ),
        wind_speed=Series(
            timestamps=[stamps[i] for i in keep],
            values=[hourly["wind_speed_10m"][i] or 0.0 for i in keep],
            unit="m/s",
            provenance=Provenance.MODEL_ESTIMATE,
        ),
        source=source,
    )


def _get_json(url: str) -> dict:
    with urlopen(url, timeout=20) as response:  # noqa: S310 - fixed https hosts
        return json.load(response)
