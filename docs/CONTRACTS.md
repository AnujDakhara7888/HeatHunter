# HeatHunter integration contracts

`backend/app/contracts.py` is the canonical source for Python, OpenAPI, and
generated TypeScript types. This document explains ownership and semantics; it
does not duplicate every field.

## Conventions

- JSON fields and identifiers use `snake_case`.
- Timestamps are timezone-aware ISO 8601 values serialized in UTC.
- Temperature: °C (`degC`). Conductance: W/K. Capacity: J/K.
- Energy: kWh. Wind: m/s. Volume: m³. Fan airflow: m³/h. Money: USD.
- Missing measurements use `null`; absent optional results also use `null`.
- Series timestamps and values must be aligned, unique, and increasing.
- Contract models reject unknown fields.

Allowed provenance values are `REAL_MEASUREMENT`, `SIMULATED_MEASUREMENT`,
`SIMULATED_GROUND_TRUTH`, `MODEL_ESTIMATE`, and `ASSUMPTION`.

## Safety boundary

Public scenario creation and observation responses never contain `GroundTruth`,
hidden fault severity, or private simulator coefficients. The diagnosis service
accepts only public templates, observations, weather, and protocol information.
Only `GET /api/scenarios/{scenario_id}/reveal` returns `GroundTruth`.

The Real Homes response has no room-level fault label. Its disclaimer must state
that it demonstrates real measurements and does not validate synthetic
root-cause classification.

## HTTP surface

| Method | Path | Request | Response | Owning implementation |
|---|---|---|---|---|
| GET | `/api/health` | — | `HealthResponse` | Nikhil/integration |
| POST | `/api/scenarios` | `ScenarioCreateRequest` | `ScenarioCreated` | Mihir |
| GET | `/api/scenarios/{id}/observations` | — | `ObservationResponse` | Mihir |
| POST | `/api/scenarios/{id}/diagnose` | `DiagnoseRequest` | `Diagnosis` | Mihir using Kailash fits |
| POST | `/api/scenarios/{id}/experiments` | `ExperimentRequest` | `ExperimentResponse` | Mihir |
| POST | `/api/scenarios/{id}/repair` | `RepairRequest` | `RepairResult` | Mihir using Kailash savings |
| GET | `/api/scenarios/{id}/reveal` | — | `GroundTruth` | Mihir private truth store |
| GET | `/api/real/house` | — | `RealHouse` | Anuj data, Nikhil route |
| GET | `/api/evaluation/summary` | — | `EvaluationSummary` | Anuj data, Nikhil route |

Until services are connected, the scaffold returns HTTP 501 with
`SERVICE_NOT_INTEGRATED`; it never returns fake scientific results.

## Python service interfaces

The exact async boundaries are defined as protocols in `backend/app/services.py`:

```python
ScenarioService.create_scenario(request: ScenarioCreateRequest) -> ScenarioCreated
ScenarioService.get_observations(scenario_id: str) -> ObservationResponse
ScenarioService.diagnose(scenario_id: str, request: DiagnoseRequest) -> Diagnosis
ScenarioService.run_experiment(scenario_id: str, request: ExperimentRequest) -> ExperimentResponse
ScenarioService.apply_repair(scenario_id: str, request: RepairRequest) -> RepairResult
ScenarioService.reveal(scenario_id: str) -> GroundTruth
RealHouseService.get_selected_house() -> RealHouse
EvaluationService.get_summary() -> EvaluationSummary
```

Internal modules may remain synchronous; the adapter at the API boundary owns
conversion to these async interfaces and public models.

## OpenAPI and TypeScript

Export after any contract change:

```bash
python -m backend.app.export_openapi --output frontend/openapi.json
cd frontend && npm run generate:api
```

Never create hand-written TypeScript copies of these interfaces.
