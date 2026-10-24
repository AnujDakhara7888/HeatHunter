from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.data_pipeline.acquire_noaa_weather import _parse_record
from backend.data_pipeline.weather import (
    WeatherDataError,
    list_weather_nights,
    load_weather_night,
    load_weather_wind_direction,
)


def test_cached_night_also_matches_canonical_api_contract() -> None:
    """The preserved NOAA resource remains compatible with the frozen API contract."""

    from backend.app.contracts import WeatherNight

    WeatherNight.model_validate(load_weather_night("kisp-2025-01-07"))


def test_offline_cache_has_balanced_training_and_heldout_nights() -> None:
    all_nights = list_weather_nights()

    assert len(all_nights) == 8
    assert len(list_weather_nights("training")) == 4
    assert len(list_weather_nights("heldout")) == 4
    for split in ("training", "heldout"):
        regimes = {night["weather_regime"] for night in list_weather_nights(split)}
        assert {"calm", "windy"}.issubset(regimes)


@pytest.mark.parametrize("summary", list_weather_nights())
def test_every_cached_night_matches_reader_contract(summary: dict[str, object]) -> None:
    night = load_weather_night(str(summary["night_id"]))

    assert night["train_or_heldout_split"] == summary["train_or_heldout_split"]
    assert night["source"]["station_id"] == "smeter-phase2-central-weather-station"
    assert night["location"]["coordinates_status"] == "not_published"
    assert "latitude" not in night["location"]
    assert "longitude" not in night["location"]
    assert night["outdoor_temperature"]["unit"] == "degC"
    assert night["wind_speed"]["unit"] == "m/s"
    assert night["outdoor_temperature"]["provenance"] == "REAL_MEASUREMENT"
    assert len(night["outdoor_temperature"]["values"]) == 25
    assert max(night["outdoor_temperature"]["values"]) < 10
    assert night["data_quality"]["missing_temperature_count"] == 0
    assert night["data_quality"]["missing_wind_speed_count"] == 0

    direction = load_weather_wind_direction(str(summary["night_id"]))
    assert direction["wind_direction"]["unit"] == "degrees_from_north"
    assert direction["wind_direction"]["timestamps"] == night["wind_speed"]["timestamps"]
    assert len(direction["wind_direction"]["values"]) == 25


def test_default_weather_catalog_contains_no_noaa_inputs() -> None:
    summaries = list_weather_nights()

    assert summaries
    assert all(not str(summary["night_id"]).startswith("kisp-") for summary in summaries)
    assert all(
        summary["source_station_id"] == "smeter-phase2-central-weather-station"
        for summary in summaries
    )


def test_timezone_conversion_is_explicit_and_in_gmt() -> None:
    night = load_weather_night("smeter-hh09-2021-02-12")

    assert night["location"]["timezone"] == "Europe/London"
    assert night["outdoor_temperature"]["timestamps"][0] == "2021-02-12T18:00:00Z"
    assert night["outdoor_temperature"]["timestamps"][-1] == "2021-02-13T06:00:00Z"


def test_unknown_night_does_not_trigger_a_network_fallback() -> None:
    with pytest.raises(FileNotFoundError, match="Unknown cached weather night"):
        load_weather_night("kisp-2099-01-01")


def test_legacy_noaa_cache_is_preserved_but_not_listed_by_default() -> None:
    legacy = load_weather_night("kisp-2025-01-07")

    assert legacy["source"]["station_call_sign"] == "KISP"
    assert all(summary["night_id"] != "kisp-2025-01-07" for summary in list_weather_nights())


def test_reader_rejects_misaligned_cached_series(tmp_path: Path) -> None:
    valid = load_weather_night("kisp-2025-01-07")
    valid["night_id"] = "broken"
    valid["wind_speed"]["timestamps"] = valid["wind_speed"]["timestamps"][:-1]
    (tmp_path / "broken.json").write_text(json.dumps(valid), encoding="utf-8")

    with pytest.raises(WeatherDataError, match="non-empty and aligned"):
        load_weather_night("broken", data_dir=tmp_path)


def test_noaa_parser_uses_documented_tenths_units() -> None:
    parsed = _parse_record(
        {
            "REPORT_TYPE": "FM-15",
            "STATION": "72505004781",
            "DATE": "2025-01-07T00:56:00",
            "TMP": "-0056,5",
            "WND": "310,5,N,0098,5",
        }
    )

    assert parsed is not None
    assert parsed["temperature_deg_c"] == -5.6
    assert parsed["wind_speed_m_s"] == 9.8


def test_noaa_parser_rejects_special_reports_and_bad_quality() -> None:
    base = {
        "STATION": "72505004781",
        "DATE": "2025-01-07T00:56:00",
        "TMP": "-0056,5",
        "WND": "310,5,N,0098,5",
    }
    assert _parse_record({**base, "REPORT_TYPE": "FM-16"}) is None
    assert _parse_record({**base, "REPORT_TYPE": "FM-15", "TMP": "-0056,3"}) is None
