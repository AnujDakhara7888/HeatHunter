"""Acquire and normalize NOAA observations for HeatHunter's offline cache.

This development-only command reads NOAA NCEI Global Hourly JSON, selects the
predeclared cold-weather nights, and writes compact files consumed by
``backend.data_pipeline.weather``. It never runs during the demo.
"""

from __future__ import annotations

import argparse
import json
import statistics
import urllib.request
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

STATION_ID = "72505004781"
STATION_NAME = "ISLIP LI MACARTHUR AIRPORT, NY US"
STATION_CALL_SIGN = "KISP"
STATION_LATITUDE = 40.79389
STATION_LONGITUDE = -73.10181
STATION_ELEVATION_M = 25.4
LOCAL_TIMEZONE = "America/New_York"
START_DATE = "2025-01-01T00:00:00"
END_DATE = "2025-03-01T23:59:59"
NOAA_DATASET = "global-hourly"
SOURCE_URL = (
    "https://www.ncei.noaa.gov/access/services/data/v1"
    f"?dataset={NOAA_DATASET}&stations={STATION_ID}"
    f"&startDate={START_DATE}&endDate={END_DATE}"
    "&format=json&units=metric&includeAttributes=true"
)

# Fixed before evaluation use. Each split deliberately contains calm and windy
# conditions; held-out dates must not be used for public-template calibration.
SELECTED_NIGHTS = {
    "2025-01-07": "training",
    "2025-01-13": "training",
    "2025-01-17": "training",
    "2025-01-20": "training",
    "2025-02-11": "heldout",
    "2025-02-14": "heldout",
    "2025-02-15": "heldout",
    "2025-02-21": "heldout",
}
ACCEPTED_QUALITY_FLAGS = {"0", "1", "4", "5"}


def _parse_scaled_field(field: str, missing_value: int) -> tuple[float, str] | None:
    parts = field.split(",")
    if len(parts) < 2:
        return None
    try:
        raw_value = int(parts[0])
    except ValueError:
        return None
    quality_flag = parts[1]
    if raw_value == missing_value or quality_flag not in ACCEPTED_QUALITY_FLAGS:
        return None
    return raw_value / 10.0, quality_flag


def _parse_record(record: dict[str, Any]) -> dict[str, Any] | None:
    """Return a normalized routine hourly observation, or ``None`` if unusable."""

    if str(record.get("REPORT_TYPE", "")).strip() != "FM-15":
        return None
    if str(record.get("STATION", "")) != STATION_ID:
        return None

    temperature = _parse_scaled_field(str(record.get("TMP", "")), missing_value=9999)
    wind_parts = str(record.get("WND", "")).split(",")
    if len(wind_parts) < 5:
        return None
    wind = _parse_scaled_field(",".join((wind_parts[3], wind_parts[4])), missing_value=9999)
    if temperature is None or wind is None:
        return None

    try:
        timestamp = datetime.fromisoformat(str(record["DATE"]))
    except (KeyError, ValueError):
        return None
    timestamp = timestamp.replace(tzinfo=UTC)
    return {
        "timestamp": timestamp,
        "temperature_deg_c": temperature[0],
        "wind_speed_m_s": wind[0],
        "temperature_quality_flag": temperature[1],
        "wind_quality_flag": wind[1],
    }


def _select_night_rows(records: Iterable[dict[str, Any]], local_date: str) -> list[dict[str, Any]]:
    """Select routine observations from 00:00 through 10:59 UTC for one EST night."""

    candidates: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        parsed = _parse_record(record)
        if parsed is None:
            continue
        timestamp = parsed["timestamp"]
        if timestamp.date().isoformat() == local_date and 0 <= timestamp.hour <= 10:
            candidates[timestamp.hour].append(parsed)

    rows: list[dict[str, Any]] = []
    for hour in range(11):
        hourly = candidates.get(hour, [])
        if not hourly:
            raise ValueError(f"{local_date} is missing a valid routine observation for UTC hour {hour}")
        # Routine METARs are normally at :56. This also makes a duplicate choice deterministic.
        rows.append(min(hourly, key=lambda row: abs(row["timestamp"].minute - 56)))
    return rows


def _weather_regime(mean_wind_speed: float) -> str:
    if mean_wind_speed <= 3.0:
        return "calm"
    if mean_wind_speed >= 6.0:
        return "windy"
    return "moderate"


def build_weather_night(records: Iterable[dict[str, Any]], local_date: str, split: str) -> dict[str, Any]:
    rows = _select_night_rows(records, local_date)
    temperatures = [row["temperature_deg_c"] for row in rows]
    wind_speeds = [row["wind_speed_m_s"] for row in rows]
    if statistics.mean(temperatures) > 5.0:
        raise ValueError(f"Selected night {local_date} is not a cold-weather night")

    timestamps = [row["timestamp"].isoformat().replace("+00:00", "Z") for row in rows]
    night_id = f"kisp-{local_date}"
    return {
        "schema_version": 1,
        "night_id": night_id,
        "source": {
            "provider": "NOAA National Centers for Environmental Information",
            "dataset": "Global Hourly",
            "station_id": STATION_ID,
            "station_call_sign": STATION_CALL_SIGN,
            "station_name": STATION_NAME,
            "url": SOURCE_URL,
            "citation": "NOAA NCEI Global Hourly, station 72505004781 (KISP)",
            "notes": (
                "Source timestamps are UTC. FM-15 routine reports only; NOAA quality flags "
                "0, 1, 4, and 5 retained; no imputation."
            ),
        },
        "location": {
            "name": "Islip Long Island MacArthur Airport, New York, US",
            "latitude": STATION_LATITUDE,
            "longitude": STATION_LONGITUDE,
            "elevation_m": STATION_ELEVATION_M,
            "distance_to_stony_brook_km_approx": 14.0,
            "timezone": LOCAL_TIMEZONE,
        },
        "local_night_date": local_date,
        "utc_window": {
            "start": f"{local_date}T00:00:00Z",
            "end": f"{local_date}T10:59:59Z",
            "note": "Equivalent to the prior evening through early morning in EST.",
        },
        "outdoor_temperature": {
            "timestamps": timestamps,
            "values": temperatures,
            "unit": "degC",
            "provenance": "REAL_MEASUREMENT",
        },
        "wind_speed": {
            "timestamps": timestamps,
            "values": wind_speeds,
            "unit": "m/s",
            "provenance": "REAL_MEASUREMENT",
        },
        "train_or_heldout_split": split,
        "selection_metadata": {
            "weather_regime": _weather_regime(statistics.mean(wind_speeds)),
            "mean_temperature_deg_c": round(statistics.mean(temperatures), 3),
            "mean_wind_speed_m_s": round(statistics.mean(wind_speeds), 3),
            "observation_count": len(rows),
            "temperature_quality_flags": [row["temperature_quality_flag"] for row in rows],
            "wind_quality_flags": [row["wind_quality_flag"] for row in rows],
        },
    }


def build_cache(records: list[dict[str, Any]], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    nights = [build_weather_night(records, date, split) for date, split in SELECTED_NIGHTS.items()]
    for night in nights:
        path = output_dir / f"{night['night_id']}.json"
        path.write_text(json.dumps(night, indent=2) + "\n", encoding="utf-8")

    summaries = [
        {
            "night_id": night["night_id"],
            "local_night_date": night["local_night_date"],
            "train_or_heldout_split": night["train_or_heldout_split"],
            "weather_regime": night["selection_metadata"]["weather_regime"],
            "mean_temperature_deg_c": night["selection_metadata"]["mean_temperature_deg_c"],
            "mean_wind_speed_m_s": night["selection_metadata"]["mean_wind_speed_m_s"],
        }
        for night in nights
    ]
    index = {
        "schema_version": 1,
        "source": "NOAA NCEI Global Hourly, station 72505004781 (KISP)",
        "nights": sorted(summaries, key=lambda item: item["local_night_date"]),
    }
    (output_dir / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


def _load_source(raw_input: Path | None) -> list[dict[str, Any]]:
    if raw_input is None:
        with urllib.request.urlopen(SOURCE_URL, timeout=120) as response:  # noqa: S310 - fixed HTTPS URL
            payload = json.load(response)
    else:
        with raw_input.open(encoding="utf-8") as handle:
            payload = json.load(handle)
    if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
        raise ValueError("NOAA response must be an array of observation objects")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--raw-input",
        type=Path,
        help="Existing NOAA JSON response. Omit to download from the fixed source URL.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data" / "weather",
    )
    args = parser.parse_args()
    build_cache(_load_source(args.raw_input), args.output_dir)


if __name__ == "__main__":
    main()
