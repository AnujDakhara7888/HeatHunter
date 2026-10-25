"""Experience API: fitted curves, custom homes and assistant fallbacks."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.tests.test_api_integration import assert_no_truth


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def guided(client: TestClient) -> dict:
    created = client.post(
        "/api/scenarios", json={"mode": "guided", "guided_scenario_id": "hh09-guided-insulation-v1"}
    ).json()
    path = f"/api/scenarios/{created['scenario_id']}"
    observations = client.get(path + "/observations").json()
    diagnosis = client.post(path + "/diagnose", json={}).json()
    return {"observations": observations, "diagnosis": diagnosis}


def test_fit_curves_reproduce_the_diagnosis(client: TestClient, guided: dict) -> None:
    response = client.post("/api/insight/fits", json={"nights": guided["observations"]["nights"]})
    assert response.status_code == 200
    body = response.json()
    assert_no_truth(body)
    flagged = guided["diagnosis"]["flagged_room_id"]
    room = next(r for r in body["rooms"] if r["room_id"] == flagged)
    assert room["anomaly_score"] == max(r["anomaly_score"] for r in body["rooms"])
    by_cause = {f["fault_type"]: f for f in room["fits"]}
    for cause in guided["diagnosis"]["ranked_causes"]:
        assert by_cause[cause["fault_type"]]["bic"] == pytest.approx(cause["bic"], rel=1e-6)
    night_id = guided["observations"]["nights"][0]["night_id"]
    curve = by_cause["envelope_conduction"]["predicted"][night_id]
    assert curve["provenance"] == "MODEL_ESTIMATE" and len(curve["values"]) > 50


def test_sample_plan_builds_a_template(client: TestClient) -> None:
    plan = client.get("/api/homes/sample-plan").json()
    response = client.post("/api/homes/template", json=plan)
    assert response.status_code == 200
    home = response.json()
    rooms = {r["room_id"] for r in home["template"]["rooms"]}
    assert rooms == {"bedroom", "kitchen", "living_room", "hall", "bathroom"}  # closet has no sensor
    assert home["exterior_wall_length_m"]["living_room"] == pytest.approx(7.5, abs=0.05)
    assert any(a["name"] == "envelope_conductance_per_exposed_m2" for a in home["assumptions"])


def test_overlapping_rooms_are_rejected(client: TestClient) -> None:
    plan = {
        "plan_id": "bad",
        "name": "bad",
        "rooms": [
            {"room_id": "a", "name": "A", "x": 0, "z": 0, "width": 3, "depth": 3},
            {"room_id": "b", "name": "B", "x": 1, "z": 1, "width": 3, "depth": 3},
        ],
    }
    assert client.post("/api/homes/template", json=plan).status_code == 422


def _series(start: datetime, values: list[float], provenance: str = "REAL_MEASUREMENT") -> dict:
    return {
        "timestamps": [(start + timedelta(minutes=30 * i)).isoformat() for i in range(len(values))],
        "values": values,
        "unit": "degC",
        "provenance": provenance,
    }


def test_home_analysis_screens_user_readings(client: TestClient) -> None:
    plan = {
        "plan_id": "two-room",
        "name": "Two rooms",
        "rooms": [
            {"room_id": "lounge", "name": "Lounge", "x": 0, "z": 0, "width": 4, "depth": 4},
            {"room_id": "bed", "name": "Bed", "x": 4, "z": 0, "width": 3, "depth": 4},
        ],
        "openings": [{"kind": "window", "x0": 1, "z0": 0, "x1": 3, "z1": 0}],
    }
    start = datetime(2026, 1, 10, 22, tzinfo=UTC)
    n = 17
    lounge = [20 - 3 * (1 - 0.88**i) for i in range(n)]
    bed = [20 - 6 * (1 - 0.85**i) for i in range(n)]
    body = {
        "plan": plan,
        "room_temperature_series": {"lounge": _series(start, lounge), "bed": _series(start, bed)},
        "outdoor_temperature": _series(start, [3.0] * n, "MODEL_ESTIMATE"),
        "wind_speed": {**_series(start, [1.0] * n, "MODEL_ESTIMATE"), "unit": "m/s"},
    }
    response = client.post("/api/homes/analyze", json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] in {"no_fault", "unexplained", "ambiguous", "confident"}
    assert {r["room_id"] for r in result["rooms"]} == {"lounge", "bed"}
    assert result["nights"][0]["room_temperature_series"]["bed"]["provenance"] == "REAL_MEASUREMENT"
    assert any("no verified fault labels" in u for u in result["uncertainty"])


def test_assistant_reports_unavailable_without_credentials(client: TestClient, monkeypatch, tmp_path) -> None:
    from backend.app import assistant

    monkeypatch.setattr(assistant, "ENV_FILE", tmp_path / "missing.env")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    response = client.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert response.status_code == 503
    assert response.json()["code"] == "ASSISTANT_UNAVAILABLE"


def test_assistant_replaces_off_topic_answers(client: TestClient, monkeypatch) -> None:
    from backend.app import assistant

    reply = {"on_topic": False, "reply": "Paris.", "actions": [{"type": "set_view", "target": "fan"}]}
    monkeypatch.setattr(assistant, "_create", lambda **_: (reply, "test-model"))
    response = client.post(
        "/api/assistant/chat", json={"messages": [{"role": "user", "content": "Capital of France?"}]}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"reply": assistant.OFF_TOPIC_REPLY, "actions": [], "model": "test-model"}


def test_assistant_passes_on_topic_answers(client: TestClient, monkeypatch) -> None:
    from backend.app import assistant

    actions = [{"type": "set_view", "target": "fan"}]
    reply = {"on_topic": True, "reply": "The hall leaks air.", "actions": actions}
    monkeypatch.setattr(assistant, "_create", lambda **_: (reply, "test-model"))
    body = {"messages": [{"role": "user", "content": "Why the hall?"}]}
    response = client.post("/api/assistant/chat", json=body)
    assert response.json()["reply"] == "The hall leaks air."
    assert response.json()["actions"] == actions


def test_assistant_reads_key_from_env_file(monkeypatch, tmp_path) -> None:
    from backend.app import assistant

    env = tmp_path / ".env"
    env.write_text("# comment\nexport ANTHROPIC_API_KEY='sk-test'\n")
    monkeypatch.setattr(assistant, "ENV_FILE", env)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assistant._load_env_file()
    assert assistant.os.environ["ANTHROPIC_API_KEY"] == "sk-test"


def test_openapi_lists_experience_routes(client: TestClient) -> None:
    paths = json.loads(client.get("/openapi.json").text)["paths"]
    for route in ("/api/insight/fits", "/api/homes/analyze", "/api/assistant/chat"):
        assert route in paths


def test_money_can_price_the_runner_up(client: TestClient) -> None:
    created = client.post(
        "/api/scenarios", json={"mode": "guided", "guided_scenario_id": "hh09-guided-insulation-v1"}
    ).json()
    path = f"/api/scenarios/{created['scenario_id']}"
    client.get(path + "/observations")
    first = client.post(path + "/diagnose", json={}).json()
    after = client.post(
        path + "/experiments",
        json={"diagnosis_id": first["diagnosis_id"], "experiment_type": "exhaust_fan_depressurization"},
    ).json()["updated_diagnosis"]
    lead = client.post(path + "/money", json={"diagnosis_id": after["diagnosis_id"]}).json()
    alt = client.post(
        path + "/money", json={"diagnosis_id": after["diagnosis_id"], "fault_type": "draft"}
    ).json()
    assert lead["estimate"] and alt["estimate"]
    assert any(a["name"] == "repair_cost_add_insulation" for a in lead["estimate"]["assumptions"])
    assert any(a["name"] == "repair_cost_seal_leaks" for a in alt["estimate"]["assumptions"])
    bad = client.post(path + "/money", json={"diagnosis_id": after["diagnosis_id"], "fault_type": "normal"})
    assert bad.status_code == 422


def test_wind_direction_companion(client: TestClient) -> None:
    response = client.get("/api/weather/smeter-hh09-2020-12-06/wind-direction")
    assert response.status_code == 200
    body = response.json()
    assert body["unit"] == "degrees_from_north" and body["provenance"] == "REAL_MEASUREMENT"
    assert all(0 <= v <= 360 for v in body["values"] if v is not None)
    assert client.get("/api/weather/not-a-night/wind-direction").status_code == 404
