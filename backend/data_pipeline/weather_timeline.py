"""Continuous HH09-region winter weather for multi-night monitoring.

The SMETER Phase 2 central weather station publishes 30-minute means from late
November 2019 through February 2021. Monitoring a house over days needs
consecutive nights, not the eight hand-picked nights in ``data/weather/hh09``.
This module extracts two whole heating seasons from the official archive and
serves them as consecutive ``WeatherNight`` objects:

* winter 2019-20 (nights of 26 Nov 2019 - 27 Mar 2020) is the TRAINING split;
* winter 2020-21 (nights of 1 Nov 2020 - 27 Feb 2021) is the HELD-OUT split.

Both windows lie entirely in GMT, so the archive's local clock (documented
assumption ``Europe/London``) equals UTC. Values are stored exactly as
published; nothing is interpolated or imputed. A night with any missing value
is reported as unavailable rather than repaired.

The legacy eight-night cache labelled 2020-12-06 as training. Timeline nights
use their own ``hh09-night-`` IDs and the season split above, so the two
catalogues are never mixed.

Extraction (offline, from the verified official ZIP):
    .venv/bin/python -m backend.data_pipeline.weather_timeline <archive.zip>
"""

from __future__ import annotations

import argparse
import json
import statistics
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from backend.app.contracts import Split, WeatherNight

from .build_hh09_twin import RAW_SERIES_REFERENCE, TIMEZONE_ASSUMPTION, _extract_source_rows, _source
from .weather import WEATHER_ROOT

TIMELINE_DIR = WEATHER_ROOT / "hh09" / "timeline"
INTERVAL_MINUTES = 30
NIGHT_START_HOUR = 18  # local; nights run 18:00 to 06:00 inclusive, like the legacy cache
NIGHT_SAMPLES = 25
CALM_MAX_WIND = 2.0  # m/s, same regime rule as the legacy cache index
WINDY_MIN_WIND = 4.0


@dataclass(frozen=True)
class Season:
    season_id: str
    split: Split
    first_day: date
    last_day: date  # date of the last night; it ends at 06:00 the next morning


SEASONS = (
    # The last nights end before the 29 Mar 2020 clock change and the sparse March 2021 data.
    Season("winter-2019-20", Split.TRAINING, date(2019, 11, 26), date(2020, 3, 27)),
    Season("winter-2020-21", Split.HELDOUT, date(2020, 11, 1), date(2021, 2, 27)),
)


class TimelineError(ValueError):
    """Raised when timeline data is missing, malformed or would cross splits."""


def _number_or_none(text: str) -> float | None:
    text = text.strip()
    return float(text) if text else None


def _season_payload(season: Season, rows_by_time: dict[datetime, dict[str, str]]) -> dict[str, Any]:
    start = datetime.combine(season.first_day, datetime.min.time())
    last_night_end = datetime.combine(season.last_day, datetime.min.time()) + timedelta(
        hours=NIGHT_START_HOUR, minutes=INTERVAL_MINUTES * (NIGHT_SAMPLES - 1)
    )
    count = int((last_night_end - start) / timedelta(minutes=INTERVAL_MINUTES)) + 1
    temperature, wind, direction = [], [], []
    for step in range(count):
        row = rows_by_time.get(start + timedelta(minutes=INTERVAL_MINUTES * step))
        temperature.append(None if row is None else _number_or_none(row["Air temp (degC)"]))
        wind.append(None if row is None else _number_or_none(row["Windspeed (m/s)"]))
        direction.append(None if row is None else _number_or_none(row["Wind direction (from N)"]))
    return {
        "schema_version": 1,
        "season_id": season.season_id,
        "train_or_heldout_split": season.split.value,
        "source": {
            **_source(),
            "dataset": "SMETER Phase 2 central weather station",
            "notes": (
                f"Raw source: {RAW_SERIES_REFERENCE}. Published as 30-minute means of 10-minute "
                "weather measurements. No source quality-flag columns are published."
            ),
            "station_id": "smeter-phase2-central-weather-station",
            "station_name": "SMETER Phase 2 central weather station (exact coordinates unpublished)",
        },
        "location": {
            "name": "SMETER Phase 2 study area, northwest England",
            "timezone": TIMEZONE_ASSUMPTION,
            "coordinates_status": "not_published",
            "distance_to_hh09_km": 5.2,
        },
        "start_utc": start.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z"),
        "interval_minutes": INTERVAL_MINUTES,
        "clock_note": "Local archive times; the whole season is in GMT, so local time equals UTC.",
        "outdoor_temperature_deg_c": temperature,
        "wind_speed_m_s": wind,
        "wind_direction_deg_from_north": direction,
        "data_quality": {
            "missing_temperature_count": sum(v is None for v in temperature),
            "missing_wind_speed_count": sum(v is None for v in wind),
            "missing_wind_direction_count": sum(v is None for v in direction),
            "imputation": "none",
            "source_quality_flags_available": False,
        },
    }


def build_weather_timeline(archive_path: Path, output_dir: Path = TIMELINE_DIR) -> list[Path]:
    """Extract both heating seasons from the verified official archive (no network access)."""

    *_, series_rows = _extract_source_rows(archive_path)
    rows_by_time = {datetime.strptime(row[""], "%d/%m/%Y %H:%M"): row for row in series_rows}
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for season in SEASONS:
        path = output_dir / f"smeter-hh09-{season.season_id}.json"
        path.write_text(json.dumps(_season_payload(season, rows_by_time)) + "\n", encoding="utf-8")
        paths.append(path)
    return paths


@lru_cache(maxsize=4)
def load_season(split: str, data_dir: Path = TIMELINE_DIR) -> dict[str, Any]:
    """Load one season's continuous series (cached; treat the result as read-only)."""

    season = next((s for s in SEASONS if s.split.value == split), None)
    if season is None:
        raise ValueError("split must be 'training' or 'heldout'")
    path = Path(data_dir) / f"smeter-hh09-{season.season_id}.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"Weather timeline missing: {path}. "
            "Run python -m backend.data_pipeline.weather_timeline <archive>"
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("train_or_heldout_split") != split or payload.get("season_id") != season.season_id:
        raise TimelineError(f"{path.name} does not hold the {split} season")
    lengths = {
        len(payload[key])
        for key in ("outdoor_temperature_deg_c", "wind_speed_m_s", "wind_direction_deg_from_north")
    }
    if len(lengths) != 1 or payload.get("interval_minutes") != INTERVAL_MINUTES:
        raise TimelineError(f"{path.name} series are misaligned")
    return payload


def _night_slice(payload: dict[str, Any], night_date: date) -> tuple[list[datetime], int]:
    start = datetime.fromisoformat(payload["start_utc"].replace("Z", "+00:00"))
    first = datetime.combine(night_date, datetime.min.time(), UTC) + timedelta(hours=NIGHT_START_HOUR)
    index = int((first - start) / timedelta(minutes=INTERVAL_MINUTES))
    if index < 0 or index + NIGHT_SAMPLES > len(payload["outdoor_temperature_deg_c"]):
        raise TimelineError(f"{night_date} is outside the {payload['season_id']} season")
    times = [first + timedelta(minutes=INTERVAL_MINUTES * k) for k in range(NIGHT_SAMPLES)]
    return times, index


def night_dates(split: str, data_dir: Path = TIMELINE_DIR) -> list[date]:
    """Every night in the season whose 18:00-06:00 weather is complete, in date order."""

    payload = load_season(split, data_dir)
    season = next(s for s in SEASONS if s.split.value == split)
    dates = []
    day = season.first_day
    while day <= season.last_day:
        _, index = _night_slice(payload, day)
        window = slice(index, index + NIGHT_SAMPLES)
        if (
            None not in payload["outdoor_temperature_deg_c"][window]
            and None not in payload["wind_speed_m_s"][window]
        ):
            dates.append(day)
        day += timedelta(days=1)
    return dates


def timeline_night(split: str, night_date: date, data_dir: Path = TIMELINE_DIR) -> WeatherNight:
    """One consecutive-season night as a canonical ``WeatherNight`` (coordinates stay null)."""

    payload = load_season(split, data_dir)
    times, index = _night_slice(payload, night_date)
    window = slice(index, index + NIGHT_SAMPLES)
    temperatures = payload["outdoor_temperature_deg_c"][window]
    winds = payload["wind_speed_m_s"][window]
    if None in temperatures or None in winds:
        raise TimelineError(f"{night_date} has missing weather; it is not repaired")
    mean_wind = statistics.fmean(winds)
    regime = "calm" if mean_wind <= CALM_MAX_WIND else "windy" if mean_wind >= WINDY_MIN_WIND else "moderate"
    stamps = [t.isoformat().replace("+00:00", "Z") for t in times]
    raw = payload["source"]
    source = {
        "provider": raw["provider"],
        "dataset": raw["dataset"],
        "url": raw["record_url"],
        "citation": raw["citation"],
        "notes": (
            f"{raw['notes']} DOI {raw['doi']}; archive SHA-256 {raw['archive_sha256']}. "
            "HH09-region station coordinates are unpublished; distance to HH09 is "
            f"{payload['location']['distance_to_hh09_km']} km."
        ),
        "station_id": raw["station_id"],
        "station_name": raw["station_name"],
    }
    return WeatherNight.model_validate(
        {
            "night_id": f"hh09-night-{night_date.isoformat()}",
            "source": source,
            "location": {
                "name": payload["location"]["name"],
                "timezone": payload["location"]["timezone"],
                "latitude": None,
                "longitude": None,
            },
            "outdoor_temperature": {
                "timestamps": stamps,
                "values": temperatures,
                "unit": "degC",
                "provenance": "REAL_MEASUREMENT",
            },
            "wind_speed": {
                "timestamps": stamps,
                "values": winds,
                "unit": "m/s",
                "provenance": "REAL_MEASUREMENT",
            },
            "train_or_heldout_split": split,
            "local_night_date": night_date,
            "utc_window": {
                "start": stamps[0],
                "end": stamps[-1],
                "note": "18:00 through 06:00 local, inclusive; the season is in GMT (UTC+00:00).",
            },
            "selection_metadata": {
                "weather_regime": regime,
                "mean_temperature_deg_c": round(statistics.fmean(temperatures), 2),
                "mean_wind_speed_m_s": round(mean_wind, 2),
                "observation_count": NIGHT_SAMPLES,
                "temperature_quality_flags": [],
                "wind_quality_flags": [],
            },
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("archive", type=Path, help="Official 856978_data_and_documentation.zip")
    parser.add_argument("--output-dir", type=Path, default=TIMELINE_DIR)
    args = parser.parse_args()
    for path in build_weather_timeline(args.archive, args.output_dir):
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
