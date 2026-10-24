"""Regression coverage for the final service configuration through actual HTTP routes."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.runtime import THRESHOLDS_ENV, reset_runtime
from backend.app.tests.test_api_integration import assert_no_truth, create
from backend.diagnosis.settings import DEFAULT_SETTINGS_PATH


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv(THRESHOLDS_ENV, raising=False)
    reset_runtime()
    with TestClient(app) as client:
        yield client
    reset_runtime()


def assumptions(diagnosis):
    return {a["name"]: a for a in diagnosis["assumptions"]}


def assert_profile(diagnosis, phase):
    settings = json.loads(DEFAULT_SETTINGS_PATH.read_text())
    values = assumptions(diagnosis)
    assert values["decision_phase"]["value"] == phase
    for name, field in (
        ("threshold_detection_bic", "detection_bic"),
        ("threshold_ambiguity_bic", "ambiguity_bic"),
        ("threshold_adequacy_rmse", "adequacy_rmse"),
        ("threshold_separation", "separation"),
        ("measurement_noise", "measurement_noise"),
        ("confidence_enabled", "confidence_enabled"),
    ):
        assert values[name]["value"] == settings["profiles"][phase][field]
        assert "conservative calibration" in values[name]["source"]["provider"]
        assert phase in values[name]["source"]["notes"]
    assert values["fan_max_wind_speed"]["value"] == 2.0


def test_insulation_demo_completes_http_loop_with_correct_phase_profiles(client):
    sid = create(client, {"mode": "guided", "guided_scenario_id": "hh09-guided-insulation-v1"})
    observed = client.get(f"/api/scenarios/{sid}/observations").json()
    assert_no_truth(observed)
    assert observed["nights"][0]["weather"]["night_id"] == "smeter-hh09-2020-12-06"
    before = client.post(f"/api/scenarios/{sid}/diagnose", json={}).json()
    assert_no_truth(before)
    assert before["status"] == "ambiguous" and before["test_decision"]["recommended"]
    assert_profile(before, "passive")
    response = client.post(
        f"/api/scenarios/{sid}/experiments",
        json={"diagnosis_id": before["diagnosis_id"], "experiment_type": "exhaust_fan_depressurization"},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert_no_truth(result)
    assert result["observations"]["weather"]["night_id"] == "smeter-hh09-2019-12-01"
    after = result["updated_diagnosis"]
    assert after["status"] == "confident"
    assert after["flagged_room_id"] == "bedroom_2"
    assert after["ranked_causes"][0]["fault_type"] == "envelope_conduction"
    assert after["money_estimate"] is not None
    assert_profile(after, "post_fan")
    # Money lookup retains the post-test diagnosis and its exact model estimate.
    money = client.post(
        f"/api/scenarios/{sid}/money", json={"diagnosis_id": after["diagnosis_id"]}
    ).json()
    assert_no_truth(money)
    assert money["estimate"] == after["money_estimate"]
    stale = client.post(f"/api/scenarios/{sid}/repair", json={"diagnosis_id": before["diagnosis_id"]})
    assert stale.status_code == 409
    repaired = client.post(f"/api/scenarios/{sid}/repair", json={"diagnosis_id": after["diagnosis_id"]})
    assert repaired.status_code == 200, repaired.text
    assert_no_truth(repaired.json())
    assert "status: no_fault" in repaired.json()["diagnosed_improvement"]
    # Identical repair retries remain safe.
    retry = client.post(f"/api/scenarios/{sid}/repair", json={"diagnosis_id": after["diagnosis_id"]})
    assert retry.json() == repaired.json()
    truth = client.get(f"/api/scenarios/{sid}/reveal").json()
    assert truth["diagnosis_matched"] and truth["repair_addressed_cause"]


def test_draft_example_remains_uncertain_through_http_instead_of_forcing_a_repair(client):
    sid = create(client, {"mode": "guided", "guided_scenario_id": "hh09-guided-v1"})
    before = client.post(f"/api/scenarios/{sid}/diagnose", json={}).json()
    assert before["status"] == "ambiguous" and before["test_decision"]["recommended"]
    response = client.post(
        f"/api/scenarios/{sid}/experiments",
        json={"diagnosis_id": before["diagnosis_id"], "experiment_type": "exhaust_fan_depressurization"},
    )
    assert response.status_code == 200, response.text
    after = response.json()["updated_diagnosis"]
    assert_no_truth(after)
    assert after["status"] in {"ambiguous", "unexplained"}
    assert after["money_estimate"] is None
    assert_profile(after, "post_fan")
    repair = client.post(f"/api/scenarios/{sid}/repair", json={"diagnosis_id": after["diagnosis_id"]})
    assert repair.status_code == 409


def test_guided_default_matches_its_manifest_and_explicit_seed_override_is_preserved(client):
    def temperatures(request):
        sid = create(client, request)
        result = client.get(f"/api/scenarios/{sid}/observations").json()
        return result["nights"][0]["room_temperature_series"]

    base = {"mode": "guided", "guided_scenario_id": "hh09-guided-insulation-v1"}
    default = temperatures(base)
    explicit = temperatures({**base, "seed": 961029})
    alternate = temperatures({**base, "seed": 68})
    assert default == explicit
    assert alternate != default
    unknown = client.post("/api/scenarios", json={**base, "guided_scenario_id": "missing-example"})
    assert unknown.status_code == 422


@pytest.mark.parametrize(
    "problem",
    ["missing", "legacy_flat", "stale_model", "bad_fan", "missing_phase", "invalid_note", "invalid_version"],
)
def test_invalid_configuration_fails_closed_without_provisional_fallback(
    client, tmp_path, monkeypatch, problem
):
    payload = json.loads(DEFAULT_SETTINGS_PATH.read_text())
    if problem == "legacy_flat":
        payload = payload["profiles"]["passive"]
    elif problem == "stale_model":
        payload["public_assets"]["backend/engine/model.py"] = "stale"
    elif problem == "bad_fan":
        payload["fan_policy"] = {"max_wind_m_s": "not-a-number"}
    elif problem == "missing_phase":
        del payload["profiles"]["post_fan"]
    elif problem == "invalid_note":
        payload["profiles"]["passive"]["calibration_note"] = None
    elif problem == "invalid_version":
        payload["schema_version"] = True
    path = tmp_path / "settings.json"
    if problem != "missing":
        path.write_text(json.dumps(payload))
    monkeypatch.setenv(THRESHOLDS_ENV, str(path))
    response = client.post(
        "/api/scenarios", json={"mode": "guided", "guided_scenario_id": "hh09-guided-insulation-v1"}
    )
    assert response.status_code == 501, response.text
    assert response.json()["code"] == "SERVICE_NOT_INTEGRATED"
    assert client.get("/api/health").status_code == 200


def test_valid_override_is_loaded_once_and_disclosed_from_that_snapshot(client, tmp_path, monkeypatch):
    path = tmp_path / "settings.json"
    path.write_text(DEFAULT_SETTINGS_PATH.read_text())
    monkeypatch.setenv(THRESHOLDS_ENV, str(path))
    sid = create(client, {"mode": "guided", "guided_scenario_id": "hh09-guided-insulation-v1"})
    # Changing the source after startup cannot change the running controller's rules
    # or cause its disclosures to claim settings it never used.
    path.write_text("invalid after startup")
    diagnosis = client.post(f"/api/scenarios/{sid}/diagnose", json={}).json()
    assert_profile(diagnosis, "passive")
    source = assumptions(diagnosis)["threshold_detection_bic"]["source"]
    assert source["dataset"] == str(path.resolve())
    # A fresh runtime must reject the now-invalid file.
    reset_runtime()
    response = client.post("/api/scenarios", json={"mode": "surprise"})
    assert response.status_code == 501
