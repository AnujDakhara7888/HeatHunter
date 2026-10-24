from __future__ import annotations

import hashlib
import json
from pathlib import Path

from backend.data_pipeline import load_hh09_twin_inputs, load_real_house
from backend.data_pipeline.build_hh09_twin import ARCHIVE_SHA256, build_hh09_twin


def test_twin_maps_actual_hh09_rooms_to_four_stable_slots() -> None:
    twin = load_hh09_twin_inputs()
    mapping = {
        room["simulator_room_id"]: room["source_room_id"] for room in twin["rooms"]
    }

    assert mapping == {
        "living_room": "living_room",
        "kitchen": "kitchen",
        "bedroom_1": "bedroom",
        "bedroom_2": "hall",
    }
    assert twin["excluded_observed_rooms"][0]["source_room_id"] == "bathroom"
    assert twin["excluded_observed_rooms"][0]["retained_in_real_measurements"] is True


def test_all_room_geometry_distinguishes_documented_from_assumed() -> None:
    twin = load_hh09_twin_inputs()

    for room in twin["rooms"]:
        geometry = room["geometry"]
        assert geometry["floor_area"]["status"] == "documented"
        assert geometry["plan_length"]["status"] == "documented"
        assert geometry["plan_width"]["status"] == "documented"
        assert geometry["ceiling_height"]["status"] == "assumed"
        assert geometry["volume"]["status"] == "assumed"
        assert "not a measured SMETER volume" in geometry["volume"]["assumption"]


def test_whole_building_measurements_remain_reference_only() -> None:
    twin = load_hh09_twin_inputs()
    references = twin["whole_building_references"]

    assert references["co_heating_htc"]["value"] == 172.0
    assert references["co_heating_htc"]["usage"] == "reference_only"
    assert references["blower_door_air_changes_at_50pa"]["value"] == 22.03
    assert references["blower_door_air_changes_at_50pa"]["usage"] == "reference_only"
    assert all(room["unknown_simulation_parameters"] for room in twin["rooms"])


def test_real_observations_remain_separate_and_unmodified() -> None:
    real_house = load_real_house()
    twin = load_hh09_twin_inputs()

    assert set(real_house.room_temperature_series) == {
        "bathroom",
        "bedroom",
        "hall",
        "kitchen",
        "living_room",
    }
    assert all(
        series.provenance.value == "REAL_MEASUREMENT"
        for series in real_house.room_temperature_series.values()
    )
    assert "room_temperature_series" not in twin
    assert twin["provenance_isolation"]["hidden_fault_truth"] == "SIMULATED_GROUND_TRUTH"


def test_build_is_reproducible_from_checksum_pinned_archive(tmp_path: Path) -> None:
    archive = Path("/tmp/856978_data_and_documentation.zip")
    if not archive.is_file():
        return
    weather_dir = tmp_path / "weather"
    twin_path = tmp_path / "hh09_twin_inputs.json"

    generated, built_twin = build_hh09_twin(archive, weather_dir, twin_path)

    assert hashlib.sha256(archive.read_bytes()).hexdigest() == ARCHIVE_SHA256
    assert len(generated) == 17
    assert json.loads(built_twin.read_text())["weather_night_ids"] == [
        "smeter-hh09-2019-12-01",
        "smeter-hh09-2020-12-06",
        "smeter-hh09-2020-01-28",
        "smeter-hh09-2020-02-10",
        "smeter-hh09-2021-01-06",
        "smeter-hh09-2021-01-08",
        "smeter-hh09-2021-02-06",
        "smeter-hh09-2021-02-12",
    ]
