from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.data_pipeline.acquire_noaa_weather import _parse_record
from backend.data_pipeline.weather import (
    WeatherDataError,
    list_weather_nights,
    load_weather_night,
)


def test_cached_night_also_matches_canonical_api_contract() -> None:
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
    assert night["source"]["station_call_sign"] == "KISP"
    assert night["outdoor_temperature"]["unit"] == "degC"
    assert night["wind_speed"]["unit"] == "m/s"
    assert night["outdoor_temperature"]["provenance"] == "REAL_MEASUREMENT"
    assert len(night["outdoor_temperature"]["values"]) == 11
    assert max(night["outdoor_temperature"]["values"]) < 10


def test_unknown_night_does_not_trigger_a_network_fallback() -> None:
    with pytest.raises(FileNotFoundError, match="Unknown cached weather night"):
        load_weather_night("kisp-2099-01-01")


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
