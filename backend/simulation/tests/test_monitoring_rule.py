from __future__ import annotations

import json

import pytest

from backend.app.contracts import HypothesisType
from backend.diagnosis.monitoring import (
    DEFAULT_MONITORING_PATH,
    MonitoringSettings,
    assess_rooms,
    load_monitoring_settings,
)
from backend.diagnosis.settings import DecisionSettingsError
from backend.engine import load_public_template
from backend.simulation.monitoring_study import case_observations, cases, run_case
from backend.simulation.tune_monitoring import features

TEMPLATE = load_public_template()


@pytest.fixture(scope="module")
def settings() -> MonitoringSettings:
    return load_monitoring_settings(template_id=TEMPLATE.template_id)


def test_saved_settings_are_training_only_and_match_the_engine(settings) -> None:
    payload = json.loads(DEFAULT_MONITORING_PATH.read_text(encoding="utf-8"))
    assert "TRAINING" in payload["provenance"] and "Not held-out" in payload["provenance"]
    assert settings.persistence_nights >= 1
    # Strict on early nights, relaxing as evidence accumulates.
    for cause in (HypothesisType.DRAFT, HypothesisType.ENVELOPE_CONDUCTION):
        assert settings.threshold(cause, 1) >= settings.threshold(cause, 14)


def test_stale_or_foreign_settings_are_rejected(tmp_path) -> None:
    payload = json.loads(DEFAULT_MONITORING_PATH.read_text(encoding="utf-8"))
    with pytest.raises(DecisionSettingsError, match="different public template"):
        load_monitoring_settings(template_id="another-template")
    payload["public_assets"]["backend/engine/model.py"] = "stale"
    path = tmp_path / "stale.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(DecisionSettingsError, match="retune"):
        load_monitoring_settings(path, template_id=TEMPLATE.template_id)
    with pytest.raises(DecisionSettingsError, match="missing"):
        load_monitoring_settings(tmp_path / "absent.json", template_id=TEMPLATE.template_id)


def _replayed_status(case_features: dict, settings: MonitoringSettings, k: int) -> dict[str, str]:
    """Status per room after k nights, replayed from cached study fits exactly as tuned."""

    out = {}
    for room in case_features["nights"][0]:
        streak, cause = 0, None
        for night in range(1, k + 1):
            leading, excess, gain, _ = case_features["nights"][night - 1][room]
            candidate = excess > settings.threshold(HypothesisType(leading), night) and gain > 0
            streak = streak + 1 if candidate and (leading == cause or streak == 0) else int(candidate)
            cause = leading if candidate else None
        gap = case_features["nights"][k - 1][room][3]
        if streak >= settings.persistence_nights:
            out[room] = "issue" if gap > settings.cause_gap_bic else "issue_cause_unclear"
        else:
            out[room] = "watching" if streak else "healthy"
    return out


@pytest.mark.parametrize("index", [10, 70, 150])
def test_live_rule_matches_the_tuned_replay(settings, index) -> None:
    case = cases(6)[index]
    nights = 3
    _, observed = case_observations(case, nights)
    replay = features({"cases": [run_case(case, nights)]})[0]
    for k in range(1, nights + 1):
        live = {room.room_id: room.status for room in assess_rooms(observed[:k], TEMPLATE, settings)}
        assert live == _replayed_status(replay, settings, k)


def test_clear_envelope_fault_is_flagged_after_persistence(settings) -> None:
    case = next(c for c in cases(1) if c["fault_type"] == "envelope_conduction" and c["severity"] == 2.0)
    _, observed = case_observations(case, settings.persistence_nights)
    first = {r.room_id: r for r in assess_rooms(observed[:1], TEMPLATE, settings)}
    later = {r.room_id: r for r in assess_rooms(observed, TEMPLATE, settings)}
    assert later[case["room"]].status == "issue"
    assert later[case["room"]].named_cause == HypothesisType.ENVELOPE_CONDUCTION
    if settings.persistence_nights > 1:
        assert first[case["room"]].status == "watching"
    assert all(r.status == "healthy" for room_id, r in later.items() if room_id != case["room"])


def test_settings_must_match_the_template(settings) -> None:
    foreign = MonitoringSettings(**{**settings.__dict__, "template_id": "other"})
    _, observed = case_observations(cases(1)[0], 1)
    with pytest.raises(DecisionSettingsError, match="different public template"):
        assess_rooms(observed, TEMPLATE, foreign)
