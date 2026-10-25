"""API v2: homes monitored night after night (demo homes over HTTP, real homes via the service)."""

from __future__ import annotations

import json
import math
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.contracts import HomePlan, Location, Provenance, Series, SourceMetadata, WeatherLookup
from backend.app.main import app
from backend.app.monitoring_service import HomeService

PLAN_PATH = main.REPOSITORY_ROOT / "shared" / "homes" / "hh09_plan.json"
TRUTH_WORDS = ("severity", "hidden", "fault_free", "ground_truth")


@pytest.fixture(scope="module")
def client():
    main.reset_home_service()
    yield TestClient(app)
    main.reset_home_service()


def ok(response):
    assert response.status_code < 300, response.text
    return response.json()


def demo(client, **body) -> str:
    return ok(client.post("/api/demo/homes", json=body))["home_id"]


def advance(client, home_id: str, nights: int = 1) -> dict:
    return ok(client.post(f"/api/demo/homes/{home_id}/advance", json={"nights": nights}))


def statuses(health: dict) -> dict[str, str]:
    return {room["room_id"]: room["status"] for room in health["rooms"]}


def test_planted_leak_is_found_explained_and_fixed(client) -> None:
    home = demo(client, fault={"type": "draft", "room_id": "bedroom_1", "severity": 1.2}, seed=4242)
    created = ok(client.get(f"/api/homes/{home}"))
    assert created["home"]["status"] == "monitoring"
    assert set(statuses(created).values()) == {"not_enough_data"}

    first = advance(client, home)
    assert statuses(first)["bedroom_1"] == "watching"  # suspicious, not yet persistent
    health = advance(client, home, 2)
    assert health["home"]["status"] == "issue" and health["home"]["rooms_with_issues"] == 1
    bedroom = next(r for r in health["rooms"] if r["room_id"] == "bedroom_1")
    assert bedroom["status"] == "issue" and bedroom["likely_cause"] == "draft"
    assert bedroom["extra_heat_loss_percent"] > 0 and bedroom["annual_cost_gbp"] > 0
    assert all(s == "healthy" for room, s in statuses(health).items() if room != "bedroom_1")
    for payload in (created, health):
        assert not any(word in json.dumps(payload) for word in TRUTH_WORDS)

    report = ok(client.get(f"/api/homes/{home}/rooms/bedroom_1"))
    assert "air leaks" in report["headline"] and report["why"] and report["what_to_do"]
    assert report["money"]["repair_cost_gbp"] > 0 and report["money"]["payback_years"] > 0
    assert [e["nights_so_far"] for e in report["evidence_by_night"]] == [1, 2, 3]
    assert report["suggested_check"] is None and report["fix"] is None
    technical = ok(client.get(f"/api/homes/{home}/rooms/bedroom_1/technical"))
    assert {f["fault_type"] for f in technical["fits"]} == {"normal", "draft", "envelope_conduction"}
    assert any("TRAINING" in str(a["value"]) for a in technical["rule"])

    readings = ok(client.get(f"/api/homes/{home}/readings", params={"room_id": "bedroom_1"}))
    assert len(readings["nights"]) == 3 and list(readings["rooms"]) == ["bedroom_1"]
    insulation = readings["insulation"]
    assert set(insulation["envelope_u_w_per_m2k"]) == {"living_room", "kitchen", "bedroom_1", "bedroom_2"}
    assert insulation["window_u_w_per_m2k"] == 2.8 and insulation["provenance"] == "MODEL_ESTIMATE"
    assert set(insulation["room_heat_loss_w_per_k"]) == set(insulation["envelope_u_w_per_m2k"])
    expected = readings["rooms"]["bedroom_1"]["expected_if_healthy"]
    assert expected["provenance"] == "MODEL_ESTIMATE" and len(expected["values"]) > 100

    fixed = ok(client.post(f"/api/homes/{home}/rooms/bedroom_1/fix", json={"action": "seal_leaks"}))
    assert fixed["status"] == "verifying" and fixed["fix"]["found_before_fix"] == "draft"
    advance(client, home)
    after = advance(client, home)
    assert statuses(after)["bedroom_1"] == "resolved" and after["home"]["status"] == "all_clear"

    history = ok(client.get(f"/api/homes/{home}/history"))
    assert not any(word in json.dumps(history) for word in TRUTH_WORDS)
    assert [n["night_id"] for n in history["nights"]] == [n["night_id"] for n in readings["nights"]] + [
        n["night_id"] for n in history["nights"][3:]
    ] and len(history["nights"]) == 5
    room = next(r for r in history["rooms"] if r["room_id"] == "bedroom_1")
    shots = room["snapshots"]
    # what the app knew after each night, kept across the fix
    assert [s["status"] for s in shots] == ["watching", "issue", "issue", "verifying", "resolved"]
    assert [s["night_number"] for s in shots] == [1, 2, 3, 4, 5]
    assert [s["after_fix"] for s in shots] == [False, False, False, True, True]
    assert shots[1]["named_cause"] == "draft" and shots[1]["annual_cost_gbp"] > 0
    assert shots[0]["named_cause"] is None and shots[3]["nights_judged"] == 1
    assert {f["fault_type"] for f in shots[2]["fits"]} == {"normal", "draft", "envelope_conduction"}
    assert room["fix_action"] == "seal_leaks" and history["advice"]["draft"]
    # the planted fault never leaves the simulator: there is no reveal route
    assert client.get(f"/api/demo/homes/{home}/reveal").status_code in {404, 405}


def test_the_wrong_repair_changes_nothing(client) -> None:
    home = demo(client, fault={"type": "draft", "room_id": "living_room", "severity": 2.0}, seed=77)
    health = advance(client, home, 3)
    assert statuses(health)["living_room"] in {"issue", "issue_cause_unclear"}
    ok(client.post(f"/api/homes/{home}/rooms/living_room/fix", json={"action": "add_insulation"}))
    after = advance(client, home, 3)
    assert statuses(after)["living_room"] == "still_an_issue"
    assert after["home"]["status"] == "issue"


def test_healthy_demo_home_stays_clear(client) -> None:
    home = demo(client, seed=9)
    health = advance(client, home, 3)
    assert set(statuses(health).values()) == {"healthy"} and health["home"]["status"] == "all_clear"


def test_deleting_a_demo_home_forgets_it(client) -> None:
    home = demo(client, seed=11)
    advance(client, home)
    assert client.delete(f"/api/homes/{home}").status_code == 204
    assert home not in {h["home_id"] for h in ok(client.get("/api/homes"))}
    assert client.get(f"/api/homes/{home}").status_code == 404
    assert client.delete(f"/api/homes/{home}").status_code == 404


def test_homes_list_and_state_errors(client) -> None:
    home = demo(client, random_fault=True, seed=5)
    assert home in {h["home_id"] for h in ok(client.get("/api/homes"))}
    assert client.get("/api/homes/demo-unknown").status_code == 404
    assert client.get(f"/api/homes/{home}/rooms/attic").status_code == 404
    upload = {"room_temperature_series": {"kitchen": {"timestamps": [], "values": []}}}
    assert client.post(f"/api/homes/{home}/readings", json=upload).status_code == 422
    bad = {"fault": {"type": "draft", "room_id": "attic", "severity": 1.0}}
    assert client.post("/api/demo/homes", json=bad).status_code == 422
    both = {"fault": {"type": "draft", "room_id": "kitchen", "severity": 1.0}, "random_fault": True}
    assert client.post("/api/demo/homes", json=both).status_code == 422
    assert client.post(f"/api/demo/homes/{home}/advance", json={"nights": 15}).status_code == 422


# --- real homes -------------------------------------------------------------------


def _weather(location: Location, start: datetime, end: datetime) -> WeatherLookup:
    stamps = [
        start - timedelta(hours=2) + timedelta(hours=h)
        for h in range(int((end - start).total_seconds() // 3600) + 5)
    ]
    return WeatherLookup(
        location=location,
        outdoor_temperature=Series(
            timestamps=stamps, values=[3.0] * len(stamps), unit="degC", provenance=Provenance.MODEL_ESTIMATE
        ),
        wind_speed=Series(
            timestamps=stamps, values=[2.0] * len(stamps), unit="m/s", provenance=Provenance.MODEL_ESTIMATE
        ),
        source=SourceMetadata(provider="test", dataset="synthetic weather"),
    )


def _cooling(room_index: int, first_night: date, nights: int) -> Series:
    stamps, values = [], []
    for n in range(nights):
        start = datetime.combine(first_night + timedelta(days=n), datetime.min.time(), UTC) + timedelta(
            hours=21
        )
        for k in range(10 * 6 + 1):  # 21:00 to 07:00, every 10 minutes
            t = start + timedelta(minutes=10 * k)
            stamps.append(t)
            values.append(round(3 + (17 - 0.3 * room_index) * math.exp(-k / 6 / (30 + 3 * room_index)), 3))
    return Series(timestamps=stamps, values=values, unit="degC", provenance=Provenance.REAL_MEASUREMENT)


def test_real_home_turns_uploads_into_nights_and_persists(tmp_path, monkeypatch) -> None:
    from backend.app import real_homes
    from backend.app.contracts import HomeCreate, ReadingsUpload

    calls = []
    monkeypatch.setattr(real_homes, "fetch_weather", lambda *a: calls.append(a) or _weather(*a))
    service = HomeService(homes_dir=tmp_path)
    plan = HomePlan.model_validate_json(PLAN_PATH.read_text())
    summary = service.create_real(
        HomeCreate(
            name="My bungalow",
            plan=plan,
            latitude=53.0,
            longitude=-2.5,
            heating_off={"start": "22:00", "end": "06:00", "timezone": "UTC"},
        )
    )
    assert summary.kind == "real" and summary.nights_monitored == 0
    sensed = [r.room_id for r in plan.rooms if r.has_sensor]
    upload = ReadingsUpload(
        room_temperature_series={room: _cooling(i, date(2026, 1, 5), 3) for i, room in enumerate(sensed)}
    )
    health = service.upload(summary.home_id, upload)
    assert health.home.nights_monitored == 3 and len(calls) == 3
    assert {room.status for room in health.rooms} <= {"healthy", "watching", "issue", "issue_cause_unclear"}
    with pytest.raises(Exception, match="simulated clock"):
        service.advance(summary.home_id, 1)

    reloaded = HomeService(homes_dir=tmp_path)  # restart: home and cached weather come back from disk
    again = reloaded.health(summary.home_id)
    assert again.home.nights_monitored == 3 and len(calls) == 3
    assert [r.status for r in again.rooms] == [r.status for r in health.rooms]
    technical = reloaded.room_technical(summary.home_id, sensed[0])
    assert any("Transferred" in str(a.value) for a in technical.rule)
    insulation = reloaded.readings(summary.home_id).insulation
    assert set(insulation.envelope_u_w_per_m2k) == set(sensed)  # transferred per m2, so every room matches
    default = insulation.default_envelope_u_w_per_m2k
    assert all(math.isclose(u, default) for u in insulation.envelope_u_w_per_m2k.values())

    reloaded.delete(summary.home_id)  # the saved file goes too, so a restart does not bring it back
    assert not list(tmp_path.glob("home-*.json"))
    assert summary.home_id not in {h.home_id for h in HomeService(homes_dir=tmp_path).list_homes()}


def test_real_house_carries_insulation_for_its_own_rooms(client) -> None:
    house = ok(client.get("/api/real/house"))
    rooms = set(house["insulation"]["envelope_u_w_per_m2k"])
    assert rooms == {"living_room", "kitchen", "bedroom", "hall"}
    assert rooms <= set(house["room_temperature_series"])
