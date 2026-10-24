from __future__ import annotations

from backend.app.contracts import Provenance
from backend.data_pipeline.real_house import load_real_house


def test_processed_real_house_is_complete_and_schema_valid() -> None:
    house = load_real_house()

    assert house.house_id == "smeter-hh09"
    assert set(house.room_temperature_series) == {"bathroom", "bedroom", "hall", "kitchen", "living_room"}
    assert len(house.outdoor_temperature.values) == 336
    assert len(house.wind_speed.values) == 336
    assert all(len(series.values) == 336 for series in house.room_temperature_series.values())
    measured_values = (value for series in house.room_temperature_series.values() for value in series.values)
    assert all(value is not None for value in measured_values)


def test_real_house_provenance_and_scientific_boundary_are_explicit() -> None:
    house = load_real_house()

    assert house.reference_htc is not None
    assert house.reference_htc.value == 172
    assert house.reference_htc.provenance == Provenance.REAL_MEASUREMENT
    assert house.airtightness is not None
    assert house.airtightness.value == 22.03
    assert "no verified room-level fault labels" in house.scientific_disclaimer
    assert "timezone" in house.timestamp_notes.lower()


def test_floorplan_asset_exists() -> None:
    house = load_real_house()

    assert (
        load_real_house.__globals__["DEFAULT_REAL_HOUSE_PATH"]
        .parents[2]
        .joinpath(house.floor_plan_asset_path)
        .is_file()
    )
