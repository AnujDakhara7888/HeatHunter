"""Offline reader for cached HeatHunter weather nights.

The reader intentionally performs no network access. Acquisition is kept in the
separate ``acquire_noaa_weather`` module so simulations remain deterministic and
the demo works without an internet connection.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal, TypeAlias

Split: TypeAlias = Literal["training", "heldout"]
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "weather"
_VALID_SPLITS = {"training", "heldout"}
_VALID_PROVENANCE = {"REAL_MEASUREMENT"}


class WeatherDataError(ValueError):
    """Raised when a cached weather file violates the public reader contract."""


def _read_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        raise WeatherDataError(f"Invalid JSON in weather cache: {path}") from exc


def _validate_series(series: Any, field_name: str) -> None:
    if not isinstance(series, dict):
        raise WeatherDataError(f"{field_name} must be an object")

    timestamps = series.get("timestamps")
    values = series.get("values")
    if not isinstance(timestamps, list) or not isinstance(values, list):
        raise WeatherDataError(f"{field_name} must contain timestamp and value arrays")
    if not timestamps or len(timestamps) != len(values):
        raise WeatherDataError(f"{field_name} timestamps and values must be non-empty and aligned")
    if timestamps != sorted(timestamps) or len(timestamps) != len(set(timestamps)):
        raise WeatherDataError(f"{field_name} timestamps must be unique and increasing")
    if any(not isinstance(value, (int, float)) for value in values):
        raise WeatherDataError(f"{field_name} values must be numeric")
    if series.get("provenance") not in _VALID_PROVENANCE:
        raise WeatherDataError(f"{field_name} has unsupported provenance")


def _validate_weather_night(payload: Any, expected_night_id: str | None = None) -> None:
    if not isinstance(payload, dict):
        raise WeatherDataError("Weather night must be a JSON object")
    required = {
        "schema_version",
        "night_id",
        "source",
        "location",
        "outdoor_temperature",
        "wind_speed",
        "train_or_heldout_split",
    }
    missing = required.difference(payload)
    if missing:
        raise WeatherDataError(f"Weather night is missing fields: {sorted(missing)}")
    if payload["schema_version"] != 1:
        raise WeatherDataError(f"Unsupported weather schema version: {payload['schema_version']}")
    if expected_night_id is not None and payload["night_id"] != expected_night_id:
        raise WeatherDataError("Weather night ID does not match its filename")
    if payload["train_or_heldout_split"] not in _VALID_SPLITS:
        raise WeatherDataError("Weather night split must be training or heldout")

    _validate_series(payload["outdoor_temperature"], "outdoor_temperature")
    _validate_series(payload["wind_speed"], "wind_speed")
    if payload["outdoor_temperature"]["timestamps"] != payload["wind_speed"]["timestamps"]:
        raise WeatherDataError("Temperature and wind must use the same timestamps")
    if payload["outdoor_temperature"].get("unit") != "degC":
        raise WeatherDataError("Outdoor temperature must use degC")
    if payload["wind_speed"].get("unit") != "m/s":
        raise WeatherDataError("Wind speed must use m/s")


def load_weather_night(
    night_id: str,
    data_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Load one validated weather night from the checked-in offline cache.

    Args:
        night_id: Stable ID returned by :func:`list_weather_nights`.
        data_dir: Optional cache directory override, primarily for tests.

    Returns:
        A dictionary compatible with the shared ``WeatherNight`` API shape.

    Raises:
        FileNotFoundError: If ``night_id`` does not exist.
        WeatherDataError: If the cached file is malformed.
    """

    allowed_characters = "abcdefghijklmnopqrstuvwxyz0123456789-_"
    if not night_id or any(character not in allowed_characters for character in night_id):
        raise ValueError("night_id may contain only lowercase letters, digits, hyphens, and underscores")
    cache_dir = Path(data_dir) if data_dir is not None else DEFAULT_DATA_DIR
    path = cache_dir / f"{night_id}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Unknown cached weather night: {night_id}")
    payload = _read_json(path)
    _validate_weather_night(payload, expected_night_id=night_id)
    return payload


def list_weather_nights(
    split: Split | None = None,
    data_dir: str | Path | None = None,
) -> list[dict[str, Any]]:
    """List compact metadata for available offline weather nights.

    Results are sorted by local night date and contain no temperature arrays, so
    callers can cheaply select a night before loading it.
    """

    if split is not None and split not in _VALID_SPLITS:
        raise ValueError("split must be 'training', 'heldout', or None")
    cache_dir = Path(data_dir) if data_dir is not None else DEFAULT_DATA_DIR
    index = _read_json(cache_dir / "index.json")
    if not isinstance(index, dict) or not isinstance(index.get("nights"), list):
        raise WeatherDataError("Weather index must contain a nights array")

    summaries: list[dict[str, Any]] = []
    for summary in index["nights"]:
        if not isinstance(summary, dict):
            raise WeatherDataError("Every weather index entry must be an object")
        if summary.get("train_or_heldout_split") not in _VALID_SPLITS:
            raise WeatherDataError("Weather index contains an invalid split")
        if split is None or summary["train_or_heldout_split"] == split:
            summaries.append(dict(summary))
    return sorted(summaries, key=lambda item: (item["local_night_date"], item["night_id"]))
