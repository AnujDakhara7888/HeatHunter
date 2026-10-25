from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.contracts import (
    Diagnosis,
    NightObservations,
    PublicTemplate,
    ScenarioCreated,
    ScenarioCreateRequest,
    Series,
)
from backend.app.main import app

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "shared" / "fixtures"
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = {
    "scenario_create_request.json": ScenarioCreateRequest,
    "scenario_created.json": ScenarioCreated,
    "public_template.json": PublicTemplate,
    "night_observations.json": NightObservations,
    "diagnosis.json": Diagnosis,
}


@pytest.mark.parametrize(("filename", "model"), FIXTURES.items())
def test_synthetic_fixture_validates_against_canonical_contract(filename: str, model: type) -> None:
    payload = json.loads((FIXTURE_DIR / filename).read_text(encoding="utf-8"))
    validated = model.model_validate(payload)

    assert validated is not None


def test_series_rejects_misaligned_values() -> None:
    with pytest.raises(ValidationError, match="equal lengths"):
        Series.model_validate(
            {
                "timestamps": ["2025-01-01T00:00:00Z", "2025-01-01T01:00:00Z"],
                "values": [20.0],
                "unit": "degC",
                "provenance": "SIMULATED_MEASUREMENT",
            }
        )


def test_public_fixtures_do_not_expose_ground_truth() -> None:
    for filename in ("scenario_created.json", "night_observations.json", "diagnosis.json"):
        text = (FIXTURE_DIR / filename).read_text(encoding="utf-8").lower()
        assert "ground_truth" not in text
        assert "actual_room_id" not in text


def test_openapi_exposes_complete_route_surface_and_isolates_ground_truth() -> None:
    schema = app.openapi()
    expected_paths = {
        "/api/health",
        "/api/real/house",
        "/api/real/house/floor-plan",
        "/api/evaluation/summary",
        "/api/homes/sample-plan",
        "/api/weather/lookup",
        "/api/assistant/floor-plan",
        "/api/homes",
        "/api/demo/homes",
        "/api/homes/{home_id}",
        "/api/homes/{home_id}/readings",
        "/api/homes/{home_id}/rooms/{room_id}",
        "/api/homes/{home_id}/rooms/{room_id}/technical",
        "/api/homes/{home_id}/rooms/{room_id}/fix",
        "/api/demo/homes/{home_id}/advance",
        "/api/demo/homes/{home_id}/reveal",
        "/api/homes/{home_id}/assistant",
    }
    assert set(schema["paths"]) == expected_paths
    for path in expected_paths:
        assert "GroundTruth" not in json.dumps(schema["paths"][path]), path
    for path in expected_paths - {"/api/demo/homes/{home_id}/reveal"}:
        assert "DemoReveal" not in json.dumps(schema["paths"][path]), path


def test_checked_in_openapi_matches_application() -> None:
    checked_in = json.loads((REPOSITORY_ROOT / "frontend" / "openapi.json").read_text(encoding="utf-8"))

    assert checked_in == app.openapi()


def test_health_is_real() -> None:
    client = TestClient(app)

    assert client.get("/api/health").json() == {"status": "ok", "service": "heat-hunter-api"}


def test_location_accepts_unpublished_coordinates_as_null() -> None:
    from backend.app.contracts import Location

    location = Location(name="SMETER Phase 2 central weather station", timezone="Europe/London")

    assert location.latitude is None and location.longitude is None
    with pytest.raises(ValidationError):
        Location(name="bad", timezone="UTC", latitude=91, longitude=0)
