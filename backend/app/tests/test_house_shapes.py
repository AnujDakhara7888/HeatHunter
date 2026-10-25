"""House shapes: presets and saved plans that demo houses can be simulated on."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from backend.app import house_shapes, main
from backend.app.main import app

PRESETS = {"compact-cottage", "l-shaped-bungalow", "long-ranch-bungalow", "open-plan-bungalow"}
TRUTH_WORDS = ("severity", "hidden", "fault_free", "ground_truth")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(house_shapes, "SAVED_DIR", tmp_path)
    main.reset_home_service()
    yield TestClient(app)
    main.reset_home_service()


def ok(response):
    assert response.status_code < 300, response.text
    return response.json()


def test_shapes_list_the_twin_and_the_presets(client) -> None:
    shapes = ok(client.get("/api/house-shapes"))
    kinds = {s["shape_id"]: s["kind"] for s in shapes}
    assert kinds["hh09"] == "twin" and {k for k, v in kinds.items() if v == "preset"} == PRESETS
    for shape in shapes:
        sensed = sum(r.get("has_sensor", True) for r in shape["plan"]["rooms"])
        assert shape["sensed_rooms"] == (4 if shape["kind"] == "twin" else sensed)


def test_a_planted_leak_is_found_in_a_preset_shape(client) -> None:
    fault = {"type": "draft", "room_id": "kitchen", "severity": 1.2}
    request = {"house": "long-ranch-bungalow", "fault": fault, "seed": 23}
    home = ok(client.post("/api/demo/homes", json=request))
    assert home["shape_id"] == "long-ranch-bungalow" and home["name"] == "Long ranch bungalow (demo)"
    health = ok(client.post(f"/api/demo/homes/{home['home_id']}/advance", json={"nights": 2}))
    rooms = {r["room_id"]: r for r in health["rooms"]}
    assert set(rooms) == {"living_room", "kitchen", "study", "main_bedroom", "second_bedroom"}  # sensed only
    assert rooms["kitchen"]["status"] == "issue" and rooms["kitchen"]["likely_cause"] == "draft"
    assert rooms["kitchen"]["annual_cost_gbp"] > 0
    assert not any(json.dumps(health).count(word) for word in TRUTH_WORDS)
    report = ok(client.get(f"/api/homes/{home['home_id']}/rooms/kitchen"))
    assert report["money"]["repair_cost_gbp"] > 0  # priced from the plan, not HH09's rooms
    technical = ok(client.get(f"/api/homes/{home['home_id']}/rooms/kitchen/technical"))
    rule = " ".join(str(a["value"]) for a in technical["rule"])
    assert "Transferred unchanged to this long ranch bungalow" in rule
    readings = ok(client.get(f"/api/homes/{home['home_id']}/readings"))
    assert set(readings["insulation"]["envelope_u_w_per_m2k"]) == set(rooms)


def test_saved_shapes_are_reused_for_simulations_and_deletable(client) -> None:
    plan = ok(client.get("/api/house-shapes"))[1]["plan"]  # any preset as the drawn plan
    saved = ok(client.post("/api/house-shapes", json={"name": "Our flat", "plan": plan}))
    assert saved["kind"] == "saved" and saved["shape_id"].startswith("plan-our-flat-")
    assert saved["shape_id"] in {s["shape_id"] for s in ok(client.get("/api/house-shapes"))}

    home = ok(client.post("/api/demo/homes", json={"house": saved["shape_id"], "seed": 3}))
    assert home["name"] == "Our flat (demo)"
    health = ok(client.post(f"/api/demo/homes/{home['home_id']}/advance", json={"nights": 1}))
    sensed = {r["room_id"] for r in plan["rooms"] if r.get("has_sensor", True)}
    assert {r["room_id"] for r in health["rooms"]} == sensed

    assert client.delete(f"/api/house-shapes/{saved['shape_id']}").status_code == 409  # a house still uses it
    assert client.delete(f"/api/homes/{home['home_id']}").status_code == 204
    assert client.delete(f"/api/house-shapes/{saved['shape_id']}").status_code == 204
    assert saved["shape_id"] not in {s["shape_id"] for s in ok(client.get("/api/house-shapes"))}
    assert client.delete("/api/house-shapes/compact-cottage").status_code == 422  # presets stay
    assert client.post("/api/demo/homes", json={"house": "no-such-shape"}).status_code == 404


def test_unsimulable_plans_are_refused(client) -> None:
    room = {"room_id": "a", "name": "A", "x": 0, "z": 0, "width": 3, "depth": 3}
    other = {**room, "room_id": "b", "name": "B", "x": 1}
    overlapping = {"plan_id": "x", "name": "x", "rooms": [room, other]}
    assert client.post("/api/house-shapes", json={"name": "Bad", "plan": overlapping}).status_code == 422
    no_sensor = {"plan_id": "x", "name": "x", "rooms": [{**room, "has_sensor": False}]}
    assert client.post("/api/house-shapes", json={"name": "Bad", "plan": no_sensor}).status_code == 422
