"""Kept experience routes: sample plan, plan validation and assistant fallbacks."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.contracts import HomePlan
from backend.app.homes import build_home
from backend.app.main import app


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


def test_assistant_reports_unavailable_without_credentials(client: TestClient, monkeypatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    home = client.post("/api/demo/homes", json={"seed": 3}).json()["home_id"]
    response = client.post(
        f"/api/homes/{home}/assistant", json={"messages": [{"role": "user", "content": "hi"}]}
    )
    assert response.status_code == 503
    assert response.json()["code"] == "ASSISTANT_UNAVAILABLE"
