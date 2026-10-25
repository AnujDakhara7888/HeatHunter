"""Real homes for API v2: on-disk storage and turning uploads into nights.

A real home is a user's plan, location and heating-off hours plus every
sensor reading they upload. It is stored as one JSON file per home in a
git-ignored folder (``HEATHUNTER_HOMES_DIR``, default ``var/homes``), so it
survives restarts. Nights are rebuilt from the stored readings: a night is
used only when every sensed room has readings covering its heating-off
window. Its weather comes from Open-Meteo for the home's coordinates and is
cached in the same file, so it is fetched once.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from .contracts import (
    HeatingOffWindow,
    HomePlan,
    Location,
    NightObservations,
    Protocol,
    Provenance,
    Series,
    SourceMetadata,
    Split,
    WeatherNight,
)
from .homes import HomeError, fetch_weather

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
HOMES_DIR = Path(os.environ.get("HEATHUNTER_HOMES_DIR", REPOSITORY_ROOT / "var" / "homes"))
GRID_MINUTES = 10
MAX_EDGE_GAP = timedelta(minutes=30)  # readings must start/end this close to the window edges
MAX_GAP = timedelta(minutes=60)  # and never skip longer than this inside it


@dataclass
class RealHomeRecord:
    home_id: str
    name: str
    created_at: datetime
    plan: HomePlan
    location: Location
    heating_off: HeatingOffWindow
    readings: dict[str, dict[str, float]] = field(default_factory=dict)  # room -> ISO time -> degC
    weather: dict[str, dict] = field(default_factory=dict)  # night_id -> cached hourly weather
    fixes: dict[str, dict] = field(default_factory=dict)  # room -> stored fix (see monitoring_service)

    def to_json(self) -> dict:
        return {
            "schema_version": 1,
            "home_id": self.home_id,
            "name": self.name,
            "created_at": self.created_at.isoformat(),
            "plan": self.plan.model_dump(mode="json"),
            "location": self.location.model_dump(mode="json"),
            "heating_off": self.heating_off.model_dump(mode="json"),
            "readings": self.readings,
            "weather": self.weather,
            "fixes": self.fixes,
        }

    @classmethod
    def from_json(cls, payload: dict) -> RealHomeRecord:
        if payload.get("schema_version") != 1:
            raise HomeError("unsupported home file version")
        return cls(
            home_id=payload["home_id"],
            name=payload["name"],
            created_at=datetime.fromisoformat(payload["created_at"]),
            plan=HomePlan.model_validate(payload["plan"]),
            location=Location.model_validate(payload["location"]),
            heating_off=HeatingOffWindow.model_validate(payload["heating_off"]),
            readings=payload.get("readings", {}),
            weather=payload.get("weather", {}),
            fixes=payload.get("fixes", {}),
        )


def save_home(record: RealHomeRecord, directory: Path = HOMES_DIR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{record.home_id}.json"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as handle:
        json.dump(record.to_json(), handle)
        temporary = handle.name
    os.replace(temporary, path)
    return path


def load_homes(directory: Path = HOMES_DIR) -> list[RealHomeRecord]:
    if not directory.is_dir():
        return []
    return [
        RealHomeRecord.from_json(json.loads(path.read_text(encoding="utf-8")))
        for path in sorted(directory.glob("home-*.json"))
    ]


def merge_readings(record: RealHomeRecord, uploads: dict[str, Series], sensed: set[str]) -> int:
    """Add uploaded readings (later uploads win on identical timestamps); returns readings added."""

    unknown = set(uploads) - sensed
    if unknown:
        raise HomeError(f"no sensed room called {', '.join(sorted(unknown))}")
    added = 0
    for room_id, series in uploads.items():
        if series.unit != "degC":
            raise HomeError("room temperatures must be in degC")
        stored = record.readings.setdefault(room_id, {})
        for timestamp, reading in zip(series.timestamps, series.values, strict=True):
            if reading is None or not np.isfinite(reading):
                continue
            stored[timestamp.astimezone(UTC).isoformat()] = float(reading)
            added += 1
    return added


def _window(night: date, heating_off: HeatingOffWindow) -> tuple[datetime, datetime]:
    zone = ZoneInfo(heating_off.timezone)
    start_t, end_t = (time.fromisoformat(heating_off.start), time.fromisoformat(heating_off.end))
    start = datetime.combine(night, start_t, zone)
    end = datetime.combine(night + timedelta(days=1) if end_t <= start_t else night, end_t, zone)
    return start.astimezone(UTC), end.astimezone(UTC)


def _covered(times: np.ndarray, start: datetime, end: datetime) -> bool:
    edge, gap = MAX_EDGE_GAP.total_seconds(), MAX_GAP.total_seconds()
    inside = times[(times >= start.timestamp() - edge) & (times <= end.timestamp() + edge)]
    return (
        len(inside) >= 2
        and inside[0] <= start.timestamp() + edge
        and inside[-1] >= end.timestamp() - edge
        and float(np.max(np.diff(inside))) <= gap
    )


def complete_nights(record: RealHomeRecord, sensed: list[str]) -> list[tuple[date, datetime, datetime]]:
    """Heating-off windows that every sensed room fully covers, oldest first."""

    if any(not record.readings.get(room) for room in sensed):
        return []
    arrays = {
        room: np.array(sorted(datetime.fromisoformat(t).timestamp() for t in record.readings[room]))
        for room in sensed
    }
    first = min(datetime.fromtimestamp(a[0], UTC) for a in arrays.values()).date() - timedelta(days=1)
    last = max(datetime.fromtimestamp(a[-1], UTC) for a in arrays.values()).date()
    nights = []
    day = first
    while day <= last:
        start, end = _window(day, record.heating_off)
        if all(_covered(times, start, end) for times in arrays.values()):
            nights.append((day, start, end))
        day += timedelta(days=1)
    return nights


def _night_weather(record: RealHomeRecord, night_id: str, start: datetime, end: datetime) -> dict:
    cached = record.weather.get(night_id)
    if cached is None:
        lookup = fetch_weather(record.location, start, end)
        cached = {
            "timestamps": [t.isoformat() for t in lookup.outdoor_temperature.timestamps],
            "temperature": lookup.outdoor_temperature.values,
            "wind": lookup.wind_speed.values,
            "source": lookup.source.model_dump(mode="json"),
        }
        record.weather[night_id] = cached
    return cached


def build_night(
    record: RealHomeRecord, sensed: list[str], night: date, start: datetime, end: datetime
) -> NightObservations:
    """One heating-off night on a 10-minute grid: interpolated readings plus fetched weather."""

    night_id = f"{record.home_id}-{night.isoformat()}"
    weather = _night_weather(record, night_id, start, end)
    step = timedelta(minutes=GRID_MINUTES)
    grid = [start + k * step for k in range(int((end - start) / step) + 1)]
    seconds = np.array([t.timestamp() for t in grid])
    hourly = np.array([datetime.fromisoformat(t).timestamp() for t in weather["timestamps"]])
    if hourly[0] > seconds[0] or hourly[-1] < seconds[-1]:
        raise HomeError(f"weather for {night} does not cover the heating-off window")
    outdoor = np.interp(seconds, hourly, np.array(weather["temperature"], float))
    wind = np.maximum(np.interp(seconds, hourly, np.array(weather["wind"], float)), 0.0)
    rooms = {}
    for room in sensed:
        points = sorted((datetime.fromisoformat(t).timestamp(), v) for t, v in record.readings[room].items())
        xs, ys = np.array([p[0] for p in points]), np.array([p[1] for p in points])
        rooms[room] = Series(
            timestamps=grid,
            values=[round(float(v), 4) for v in np.interp(seconds, xs, ys)],
            unit="degC",
            provenance=Provenance.REAL_MEASUREMENT,
        )
    source = SourceMetadata.model_validate(weather["source"])
    weather_night = WeatherNight(
        night_id=night_id,
        source=source,
        location=record.location,
        outdoor_temperature=Series(
            timestamps=grid,
            values=[round(float(v), 3) for v in outdoor],
            unit="degC",
            provenance=Provenance.MODEL_ESTIMATE,
        ),
        wind_speed=Series(
            timestamps=grid,
            values=[round(float(v), 3) for v in wind],
            unit="m/s",
            provenance=Provenance.MODEL_ESTIMATE,
        ),
        train_or_heldout_split=Split.HELDOUT,
        local_night_date=night,
    )
    return NightObservations(
        night_id=night_id,
        kind="passive",
        room_temperature_series=rooms,
        weather=weather_night,
        protocol=Protocol(heating_off=True, doors_closed=True, fan_on=False),
    )
