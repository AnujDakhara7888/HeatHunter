"""End-to-end API tests against the real owner services (no fakes)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from backend.app.contracts import (
    Diagnosis,
    ExperimentResponse,
    GroundTruth,
    ObservationResponse,
    RepairResult,
)
from backend.app.main import app
from backend.app.runtime import load_threshold_config

TRUTH_MARKERS = (
    "actual_room_id",
    "severity",
    "diagnosis_matched",
    "repair_addressed_cause",
    "SIMULATED_GROUND_TRUTH",
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def assert_no_truth(payload: object) -> None:
    text = json.dumps(payload)
    for marker in TRUTH_MARKERS:
        assert marker not in text, f"hidden truth marker {marker!r} leaked before reveal"


def create(client: TestClient, body: dict) -> str:
    response = client.post("/api/scenarios", json=body)
    assert response.status_code == 201, response.text
    assert_no_truth(response.json())
    return response.json()["scenario_id"]


def test_guided_investigation_follows_real_services_without_leaking_truth(client: TestClient) -> None:
    scenario_id = create(client, {"mode": "guided", "guided_scenario_id": "hh09-guided-v1"})

    observations = client.get(f"/api/scenarios/{scenario_id}/observations")
    assert observations.status_code == 200
    assert_no_truth(observations.json())
    night = ObservationResponse.model_validate(observations.json()).nights[0]
    assert set(night.room_temperature_series) == {"living_room", "kitchen", "bedroom_1", "bedroom_2"}
    assert all(s.provenance == "SIMULATED_MEASUREMENT" for s in night.room_temperature_series.values())
    assert night.weather.night_id.startswith("smeter-hh09-")
    assert "Stony Brook" not in night.weather.location.name

    response = client.post(f"/api/scenarios/{scenario_id}/diagnose", json={})
    assert response.status_code == 200
    assert_no_truth(response.json())
    diagnosis = Diagnosis.model_validate(response.json())
    disclosed = {a.name for a in diagnosis.assumptions}
    assert {"threshold_ambiguity_bic", "threshold_separation"} <= disclosed

    if diagnosis.test_decision and diagnosis.test_decision.recommended:
        response = client.post(
            f"/api/scenarios/{scenario_id}/experiments",
            json={"diagnosis_id": diagnosis.diagnosis_id, "experiment_type": "exhaust_fan_depressurization"},
        )
        assert response.status_code == 200, response.text
        assert_no_truth(response.json())
        experiment = ExperimentResponse.model_validate(response.json())
        assert experiment.observations.kind == "fan_test" and experiment.observations.protocol.fan_on
        diagnosis = experiment.updated_diagnosis

    truth = client.get(f"/api/scenarios/{scenario_id}/reveal")
    assert truth.status_code == 200
    assert GroundTruth.model_validate(truth.json()).provenance == "SIMULATED_GROUND_TRUTH"


def test_judge_conduction_repair_money_and_reveal(client: TestClient) -> None:
    scenario_id = create(
        client,
        {
            "mode": "judge",
            "judge_fault_type": "envelope_conduction",
            "judge_room_id": "living_room",
            "severity": 2.0,
            "seed": 930011,
        },
    )
    diagnosis = Diagnosis.model_validate(
        client.post(f"/api/scenarios/{scenario_id}/diagnose", json={}).json()
    )
    assert diagnosis.status == "confident", diagnosis.status
    assert diagnosis.money_estimate is not None

    base = client.post(
        f"/api/scenarios/{scenario_id}/money", json={"diagnosis_id": diagnosis.diagnosis_id}
    ).json()
    doubled_price = base["estimate"]["assumptions"][2]["value"] * 2
    doubled = client.post(
        f"/api/scenarios/{scenario_id}/money",
        json={
            "diagnosis_id": diagnosis.diagnosis_id,
            "gas_price_pence_per_kwh": doubled_price,
            "repair_cost_gbp": 0,
        },
    ).json()
    assert doubled["estimate"]["annual_cost_estimate_usd"] == pytest.approx(
        2 * base["estimate"]["annual_cost_estimate_usd"]
    )
    assert doubled["estimate"]["repair_cost_usd"] == 0
    assert base["estimate"]["annual_cost_estimate_usd"] == pytest.approx(
        diagnosis.money_estimate.annual_cost_estimate_usd
    )

    response = client.post(
        f"/api/scenarios/{scenario_id}/repair",
        json={"diagnosis_id": diagnosis.diagnosis_id, "effectiveness": 0.5},
    )
    assert response.status_code == 200, response.text
    assert_no_truth(response.json())
    repair = RepairResult.model_validate(response.json())
    assert repair.effectiveness == 0.5
    assert repair.repair_type == "envelope_conduction"

    again = client.post(f"/api/scenarios/{scenario_id}/repair", json={"diagnosis_id": diagnosis.diagnosis_id})
    assert again.status_code == 409 and again.json()["code"] == "INVALID_SCENARIO_STATE"

    truth = GroundTruth.model_validate(client.get(f"/api/scenarios/{scenario_id}/reveal").json())
    assert truth.fault_type == "envelope_conduction" and truth.actual_room_id == "living_room"


def test_errors_are_explicit(client: TestClient) -> None:
    assert client.get("/api/scenarios/unknown/observations").json()["code"] == "NOT_FOUND"
    scenario_id = create(client, {"mode": "surprise"})
    stale = client.post(f"/api/scenarios/{scenario_id}/repair", json={"diagnosis_id": "nope"})
    assert stale.status_code == 409
    money = client.post(f"/api/scenarios/{scenario_id}/money", json={"diagnosis_id": "nope"})
    assert money.status_code == 404
    bad_room = client.post(
        "/api/scenarios",
        json={"mode": "judge", "judge_fault_type": "draft", "judge_room_id": "attic", "severity": 1},
    )
    assert bad_room.status_code == 422 and bad_room.json()["code"] == "INVALID_REQUEST"


def test_real_house_and_floor_plan_are_real_measurements(client: TestClient) -> None:
    house = client.get("/api/real/house").json()
    assert house["house_id"] == "smeter-hh09"
    assert all(s["provenance"] == "REAL_MEASUREMENT" for s in house["room_temperature_series"].values())
    plan = client.get("/api/real/house/floor-plan")
    assert plan.status_code == 200 and plan.headers["content-type"] == "image/png"


def test_missing_benchmark_is_reported_not_fabricated(client: TestClient, tmp_path, monkeypatch) -> None:
    import backend.app.runtime as runtime

    monkeypatch.setattr(runtime, "EVALUATION_SUMMARY", tmp_path / "absent.json")
    monkeypatch.setattr(
        "backend.app.main.load_evaluation_summary",
        lambda: runtime.load_evaluation_summary(tmp_path / "x.json"),
    )
    response = client.get("/api/evaluation/summary")
    assert response.status_code == 501 and response.json()["code"] == "SERVICE_NOT_INTEGRATED"


def test_thresholds_come_from_a_recorded_training_source() -> None:
    config = load_threshold_config()
    assert config.source_path.endswith(".json")
    assert config.ambiguity_bic > 0 and config.separation > 0
