"""Validated offline reader for the approximate HH09 digital-twin inputs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_TWIN_INPUT_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "processed" / "hh09_twin_inputs.json"
)


class TwinInputDataError(ValueError):
    """Raised when the checked-in HH09 twin package is internally inconsistent."""


def load_hh09_twin_inputs(path: str | Path | None = None) -> dict[str, Any]:
    """Load and validate the provenance-rich HH09 twin input package."""

    data_path = Path(path) if path is not None else DEFAULT_TWIN_INPUT_PATH
    if not data_path.is_file():
        raise FileNotFoundError(f"HH09 twin input package is missing: {data_path}")
    try:
        payload = json.loads(data_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise TwinInputDataError(f"Invalid HH09 twin input JSON: {data_path}") from exc

    if payload.get("reference_house_id") != "HH09":
        raise TwinInputDataError("Twin package must reference HH09")
    if payload.get("model_type") != "approximate_digital_twin":
        raise TwinInputDataError("Twin package must declare approximate_digital_twin")
    rooms = payload.get("rooms")
    if not isinstance(rooms, list) or len(rooms) != 4:
        raise TwinInputDataError("HH09 twin package must map exactly four simulator rooms")
    room_ids = {room.get("source_room_id") for room in rooms if isinstance(room, dict)}
    if room_ids != {"living_room", "kitchen", "bedroom", "hall"}:
        raise TwinInputDataError("HH09 simulator room mapping is incomplete or unexpected")
    for room in rooms:
        geometry = room.get("geometry", {})
        for name, field in geometry.items():
            if not isinstance(field, dict) or field.get("status") not in {"documented", "assumed"}:
                raise TwinInputDataError(f"Room geometry {name} lacks documented/assumed status")
            if field.get("status") == "assumed" and not field.get("assumption"):
                raise TwinInputDataError(f"Assumed room geometry {name} lacks an explanation")
    weather_ids = payload.get("weather_night_ids")
    if not isinstance(weather_ids, list) or len(weather_ids) < 8:
        raise TwinInputDataError("HH09 twin package must reference at least eight weather nights")
    return payload
