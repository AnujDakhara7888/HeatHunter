"""Adapt the richer data handoff without fabricating station coordinates."""

from __future__ import annotations

from copy import deepcopy

from pydantic import ValidationError

from backend.app.contracts import WeatherNight
from backend.data_pipeline import load_weather_night


class WeatherContractError(RuntimeError):
    """The canonical coordinate fields need integration-owner approval to be nullable."""


def load_simulation_weather(night_id: str) -> WeatherNight:
    if not night_id.startswith("smeter-hh09-"):
        raise ValueError("new HH09 scenarios cannot use legacy NOAA weather")
    raw = deepcopy(load_weather_night(night_id))
    location = raw["location"]
    coordinates_unknown = location.get("coordinates_status") == "not_published"
    if coordinates_unknown:
        location["latitude"] = None
        location["longitude"] = None
    note = (
        "HH09-region station coordinates are unpublished; distance to HH09 is "
        f"{location.get('distance_to_hh09_km', 'unknown')} km. "
        "Original data_quality and wind_direction_companion remain in the source cache."
    )
    raw["source"]["notes"] = (raw["source"].get("notes") or "") + " " + note
    location.pop("coordinates_status", None)
    location.pop("distance_to_hh09_km", None)
    raw.pop("data_quality", None)
    raw.pop("wind_direction_companion", None)
    try:
        return WeatherNight.model_validate(raw)
    except ValidationError as exc:
        coordinate_errors = {tuple(e["loc"]) for e in exc.errors()}
        if coordinates_unknown and coordinate_errors <= {
            ("location", "latitude"),
            ("location", "longitude"),
        }:
            raise WeatherContractError(
                "HH09 coordinates are unpublished. Nikhil must approve nullable "
                "Location.latitude/longitude before canonical HH09 observations can be returned."
            ) from exc
        raise
