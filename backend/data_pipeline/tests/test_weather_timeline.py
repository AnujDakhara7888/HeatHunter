from __future__ import annotations

from datetime import date, timedelta

import pytest

from backend.app.contracts import Split
from backend.data_pipeline.weather_timeline import (
    NIGHT_SAMPLES,
    SEASONS,
    TimelineError,
    load_season,
    night_dates,
    timeline_night,
)
from backend.simulation.observations import nighttime_weather


@pytest.mark.parametrize("season", SEASONS, ids=lambda s: s.season_id)
def test_each_season_is_complete_and_consecutive(season) -> None:
    payload = load_season(season.split.value)
    quality = payload["data_quality"]
    assert quality["imputation"] == "none"
    assert quality["missing_temperature_count"] == quality["missing_wind_speed_count"] == 0
    dates = night_dates(season.split.value)
    assert dates[0] == season.first_day and dates[-1] == season.last_day
    assert all(b - a == timedelta(days=1) for a, b in zip(dates, dates[1:], strict=False))
    assert len(dates) >= 119


def test_seasons_never_share_a_night_and_keep_their_split() -> None:
    training, heldout = (set(night_dates(s.value)) for s in (Split.TRAINING, Split.HELDOUT))
    assert not training & heldout
    assert max(training) < min(heldout)


def test_timeline_night_is_a_canonical_real_weather_night() -> None:
    night = timeline_night("heldout", date(2021, 1, 10))
    assert night.night_id == "hh09-night-2021-01-10"
    assert night.train_or_heldout_split == Split.HELDOUT
    assert night.location.latitude is None and night.location.longitude is None
    stamps = night.outdoor_temperature.timestamps
    assert len(stamps) == NIGHT_SAMPLES
    assert (stamps[0].hour, stamps[-1].hour) == (18, 6)
    assert night.outdoor_temperature.provenance == "REAL_MEASUREMENT"
    assert night.selection_metadata.weather_regime in {"calm", "moderate", "windy"}
    # The simulator's 22:00-06:00 heating-off crop accepts timeline nights.
    assert len(nighttime_weather(night).outdoor_temperature.timestamps) == 17


def test_nights_outside_a_season_are_rejected() -> None:
    with pytest.raises(TimelineError, match="outside"):
        timeline_night("training", date(2020, 6, 1))
    with pytest.raises(ValueError, match="split"):
        load_season("validation")
