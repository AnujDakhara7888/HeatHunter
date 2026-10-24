from __future__ import annotations

from dataclasses import asdict

import pytest

from backend.diagnosis import DecisionProfiles, DiagnosisController, Thresholds
from backend.diagnosis.settings import (
    DecisionSettingsError,
    fingerprints,
    load_settings,
    profile_payload,
    write_settings,
)
from backend.simulation.observations import fan_protocol, passive_protocol, simulate_night
from backend.simulation.physics import build_house
from backend.simulation.tests.helpers import ScriptedEngine, public_template, synthetic_weather
from backend.simulation.train_decisions import describe


def test_phase_specific_thresholds_selected_from_recorded_protocol():
    engine = ScriptedEngine()
    controller = DiagnosisController(
        engine, public_template(), DecisionProfiles(Thresholds(10, 100, 0.5), Thresholds(10, 5, 0.5))
    )
    weather = synthetic_weather(hours=2)
    a = simulate_night(build_house(1), weather, passive_protocol(), sensor_seed=2).observations
    weather.night_id = "synthetic-second-night"
    b = simulate_night(
        build_house(1), weather, fan_protocol(weather.outdoor_temperature.timestamps[0]), sensor_seed=2
    ).observations
    assert controller.analyze([a]).status == "ambiguous"
    result = controller.analyze([a, b])
    assert result.status == "confident"
    assert next(x.value for x in result.assumptions if x.name == "decision_phase") == "post_fan"


def test_confidence_can_be_disabled_when_training_check_does_not_support_it():
    weather = synthetic_weather(hours=2)
    a = simulate_night(build_house(1), weather, passive_protocol(), sensor_seed=2).observations
    threshold = Thresholds(10, 0, 0.5, confidence_enabled=False)
    assert (
        DiagnosisController(ScriptedEngine("confident"), public_template(), threshold).analyze([a]).status
        == "ambiguous"
    )


def payload():
    return {
        "schema_version": 1,
        "template_id": "qa",
        "profiles": profile_payload(DecisionProfiles(Thresholds(10, 5, 0.5), Thresholds(20, 10, 0.6))),
        "training": {"training_only": True},
        "public_assets": fingerprints(),
    }


def test_settings_roundtrip_and_asset_change_rejection(tmp_path):
    path = tmp_path / "settings.json"
    data = payload()
    write_settings(data, path)
    profiles, _ = load_settings(path, template_id="qa")
    assert asdict(profiles.passive) == data["profiles"]["passive"]
    data["public_assets"]["backend/engine/model.py"] = "old"
    write_settings(data, path)
    with pytest.raises(DecisionSettingsError, match="changed"):
        load_settings(path, template_id="qa")


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -1, True])
def test_invalid_threshold_values_rejected(bad):
    with pytest.raises(ValueError):
        Thresholds(bad, 5, 0.5)


def test_untrained_wrong_template_and_malformed_settings_rejected(tmp_path):
    path = tmp_path / "settings.json"
    write_settings(payload(), path)
    with pytest.raises(DecisionSettingsError, match="mismatch"):
        load_settings(path, template_id="other")
    data = payload()
    data["training"]["training_only"] = False
    write_settings(data, path)
    with pytest.raises(DecisionSettingsError, match="training-only"):
        load_settings(path, template_id="qa")
    path.write_text('{"broken":')
    with pytest.raises(DecisionSettingsError, match="Malformed"):
        load_settings(path, template_id="qa")


@pytest.mark.parametrize("mode", ["healthy", "ambiguous", "confident", "bad"])
def test_cached_training_selector_matches_actual_controller(mode):
    weather = synthetic_weather(hours=2)
    a = simulate_night(build_house(1), weather, passive_protocol(), sensor_seed=2).observations
    engine = ScriptedEngine(mode)
    template = public_template()
    threshold = Thresholds(10, 5, 0.5)
    actual = DiagnosisController(engine, template, threshold).analyze([a])
    from backend.app.contracts import HypothesisType

    fits = {
        r.room_id: {
            c.value: engine.fit_hypothesis([a], r.room_id, template, c).model_dump(mode="json")
            for c in HypothesisType
        }
        for r in template.rooms
    }
    expected = describe(fits, threshold)
    assert actual.status == expected["status"]
    assert actual.flagged_room_id == expected["room"]


def test_nonfinite_settings_are_not_written(tmp_path):
    path = tmp_path / "settings.json"
    data = payload()
    data["profiles"]["passive"]["detection_bic"] = float("nan")
    with pytest.raises(ValueError):
        write_settings(data, path)
    assert not path.exists()


def test_higher_post_threshold_cannot_silently_clear_a_passive_anomaly():
    weather = synthetic_weather(hours=2)
    house = build_house(1)
    a = simulate_night(house, weather, passive_protocol(), sensor_seed=2).observations
    weather.night_id = "synthetic-second-night"
    b = simulate_night(
        house, weather, fan_protocol(weather.outdoor_temperature.timestamps[0]), sensor_seed=2
    ).observations
    profiles = DecisionProfiles(Thresholds(10, 100, 0.5), Thresholds(1000, 5, 0.5))
    result = DiagnosisController(ScriptedEngine(), public_template(), profiles).analyze([a, b])
    assert result.status == "unexplained"
    assert any("Passive anomaly" in text for text in result.uncertainty)


def test_post_fan_profiles_reject_fan_only_observations():
    weather = synthetic_weather(hours=2)
    fan = simulate_night(
        build_house(1), weather, fan_protocol(weather.outdoor_temperature.timestamps[0]), sensor_seed=2
    ).observations
    controller = DiagnosisController(
        ScriptedEngine(),
        public_template(),
        DecisionProfiles(Thresholds(10, 100, 0.5), Thresholds(10, 5, 0.5)),
    )
    with pytest.raises(ValueError, match="one passive"):
        controller.analyze([fan])


def test_cached_heldout_records_cannot_be_used_for_decision_tuning():
    from backend.simulation.train_decisions import fit_profiles

    with pytest.raises(ValueError, match="TRAINING-only"):
        fit_profiles(
            [
                {
                    "cohort": "tuning",
                    "weather_nights": ["smeter-hh09-2021-01-06"],
                    "truth": {"fault": "none", "provenance": "SIMULATED_GROUND_TRUTH"},
                }
            ]
        )


def test_joint_cutoff_training_can_reject_wrong_rooms_without_rejecting_all_good_cases():
    from copy import deepcopy

    from backend.app.contracts import HypothesisType
    from backend.simulation.train_decisions import fit_profiles

    engine = ScriptedEngine("healthy")
    template = public_template()
    baseline = {
        r.room_id: {
            c.value: engine.fit_hypothesis([], r.room_id, template, c).model_dump(mode="json")
            for c in HypothesisType
        }
        for r in template.rooms
    }

    def row(kind):
        fits = deepcopy(baseline)
        fault, room = "none", None
        if kind == "healthy":
            fits["living_room"]["normal"]["bic"] = 15
        else:
            chosen = "living_room" if kind == "good" else "kitchen"
            fault, room = ("envelope_conduction", "living_room") if kind == "good" else ("draft", "bedroom_1")
            fits[chosen]["normal"]["bic"] = 100 if kind == "good" else 12
            fits[chosen]["envelope_conduction"]["bic"] = 0
            fits[chosen]["draft"]["bic"] = 20 if kind == "good" else 500
        return {
            "cohort": "tuning",
            "weather_nights": ["smeter-hh09-2019-12-01"],
            "truth": {"fault": fault, "room": room, "provenance": "SIMULATED_GROUND_TRUTH"},
            "fits": {"passive": fits, "post_fan": fits},
        }

    data = (
        [row("healthy") for _ in range(20)]
        + [row("good") for _ in range(20)]
        + [row("bad") for _ in range(4)]
    )
    check = [{**deepcopy(r), "cohort": "check"} for r in data]
    profiles, report = fit_profiles(data + check)
    assert profiles.passive.detection_bic >= 12.5
    assert report["passive"]["separate_training_check"]["confident_precision"] == 1
    assert report["passive"]["separate_training_check"]["confident_count"] == 20
