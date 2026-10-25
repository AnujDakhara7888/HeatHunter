"""Kept experience routes: sample plan, plan validation and assistant fallbacks."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.contracts import HomePlan
from backend.app.homes import build_home
from backend.app.main import app


@pytest.fixture(autouse=True)
def isolated_assistant(monkeypatch, tmp_path):
    from backend.app import assistant

    monkeypatch.setattr(assistant, "ENV_FILE", tmp_path / "missing.env")
    monkeypatch.setenv("HEATHUNTER_CHAT_PROVIDER", "claude")


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def test_sample_plan_builds_a_template(client: TestClient) -> None:
    plan = HomePlan.model_validate(client.get("/api/homes/sample-plan").json())
    home, extension = build_home(plan)
    rooms = {r.room_id for r in home.template.rooms}
    assert rooms == {"bedroom", "kitchen", "living_room", "hall", "bathroom"}  # closet has no sensor
    assert home.exterior_wall_length_m["living_room"] == pytest.approx(7.5, abs=0.05)
    assert any(a.name == "envelope_conductance_per_exposed_m2" for a in home.assumptions)
    assert set(extension.window_conductance_w_per_k) == rooms


def test_overlapping_rooms_are_rejected(client: TestClient) -> None:
    plan = {
        "plan_id": "bad",
        "name": "bad",
        "rooms": [
            {"room_id": "a", "name": "A", "x": 0, "z": 0, "width": 3, "depth": 3},
            {"room_id": "b", "name": "B", "x": 1, "z": 1, "width": 3, "depth": 3},
        ],
    }
    body = {"name": "Bad plan", "plan": plan, "latitude": 53.0, "longitude": -2.5}
    response = client.post("/api/homes", json=body)
    assert response.status_code == 422 and "overlap" in response.json()["detail"]


def test_assistant_reports_unavailable_without_credentials(client: TestClient, monkeypatch, tmp_path) -> None:
    from backend.app import assistant

    monkeypatch.setattr(assistant, "ENV_FILE", tmp_path / "missing.env")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    home = client.post("/api/demo/homes", json={"seed": 3}).json()["home_id"]
    response = client.post(
        f"/api/homes/{home}/assistant", json={"messages": [{"role": "user", "content": "hi"}]}
    )
    assert response.status_code == 503
    assert response.json()["code"] == "ASSISTANT_UNAVAILABLE"


def _ask(client: TestClient, question: str) -> dict:
    home = client.post("/api/demo/homes", json={"seed": 3}).json()["home_id"]
    response = client.post(
        f"/api/homes/{home}/assistant", json={"messages": [{"role": "user", "content": question}]}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_assistant_replaces_off_topic_answers(client: TestClient, monkeypatch) -> None:
    from backend.app import assistant

    reply = {"on_topic": False, "reply": "Paris.", "actions": [{"type": "focus_room", "target": "kitchen"}]}
    monkeypatch.setattr(assistant, "_create", lambda **_: (reply, "test-model"))
    assert _ask(client, "Capital of France?") == {
        "reply": assistant.OFF_TOPIC_REPLY,
        "actions": [],
        "model": "test-model",
    }


def test_assistant_passes_on_topic_answers_and_sees_server_context(client: TestClient, monkeypatch) -> None:
    from backend.app import assistant

    seen = {}
    actions = [{"type": "focus_room", "target": "kitchen"}, {"type": "set_view", "target": "fan"}]
    reply = {"on_topic": True, "reply": "The kitchen looks fine so far.", "actions": actions}

    def fake(**kwargs):
        seen.update(kwargs)
        return reply, "test-model"

    monkeypatch.setattr(assistant, "_create", fake)
    answer = _ask(client, "How is the kitchen?")
    assert answer["reply"] == "The kitchen looks fine so far."
    assert answer["actions"] == [{"type": "focus_room", "target": "kitchen"}]  # only room focus is offered
    prompt = seen["messages"][-1]["content"]
    assert "<home>" in prompt and '"hidden_answer": "not revealed"' in prompt


def test_assistant_reads_key_from_env_file(monkeypatch, tmp_path) -> None:
    from backend.app import assistant

    env = tmp_path / ".env"
    env.write_text("# comment\nexport ANTHROPIC_API_KEY='sk-test'\n")
    monkeypatch.setattr(assistant, "ENV_FILE", env)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assistant._load_env_file()
    assert assistant.os.environ["ANTHROPIC_API_KEY"] == "sk-test"


def test_wind_direction_companion(client: TestClient) -> None:
    response = client.get("/api/weather/smeter-hh09-2020-12-06/wind-direction")
    assert response.status_code == 200
    body = response.json()
    assert body["unit"] == "degrees_from_north" and body["provenance"] == "REAL_MEASUREMENT"
    assert all(0 <= v <= 360 for v in body["values"] if v is not None)
    assert client.get("/api/weather/not-a-night/wind-direction").status_code == 404


def test_wind_direction_for_monitoring_nights(client: TestClient) -> None:
    body = client.get("/api/weather/hh09-night-2020-12-23/wind-direction").json()
    assert body["unit"] == "degrees_from_north" and len(body["values"]) > 10
    assert client.get("/api/weather/hh09-night-1990-01-01/wind-direction").status_code == 404
