# HeatHunter integration contracts

`backend/app/contracts.py` is the canonical source for Python, OpenAPI, and
generated TypeScript types. This document explains ownership and semantics; it
does not duplicate every field.

## Conventions

- JSON fields and identifiers use `snake_case`.
- Timestamps are timezone-aware ISO 8601 values serialized in UTC.
- Temperature: °C (`degC`). Conductance: W/K. Capacity: J/K.
- Energy: kWh. Wind: m/s. Volume: m³. Fan airflow: m³/h. Money: USD.
- Currency for HH09: costs are computed in GBP (Ofgem tariff, UK repair prices)
  and converted to the contract's USD fields with the `gbp_to_usd` assumption
  carried in every `MoneyEstimate.assumptions`. The UI shows GBP first
  (`usd / gbp_to_usd`) and USD second; it never presents Long Island dollar savings.
- Missing measurements use `null`; absent optional results also use `null`.
- `Location.latitude`/`longitude` are `null` when the source does not publish
  coordinates (the SMETER Phase 2 weather station). They are never approximated.
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
| POST | `/api/scenarios/{id}/money` | `MoneyRequest` | `MoneyResponse` | Kailash `estimate_money` |
| POST | `/api/scenarios/{id}/repair` | `RepairRequest` | `RepairResult` | Mihir using Kailash savings |
| GET | `/api/scenarios/{id}/reveal` | — | `GroundTruth` | Mihir private truth store |
| GET | `/api/real/house` | — | `RealHouse` | Anuj data, Nikhil route |
| GET | `/api/real/house/floor-plan` | — | `image/png` | Anuj asset, Nikhil route |
| GET | `/api/evaluation/summary` | — | `EvaluationSummary` | Anuj data, Nikhil route |

All routes are wired to the owners' services (`backend/app/runtime.py`).
`/api/evaluation/summary` returns HTTP 501 `SERVICE_NOT_INTEGRATED` until
`reports/evaluation/summary.json` exists; it never returns fake results.

### Contract changes approved by the integration owner (2026-10-24)

Both were proposed by Kailash in `docs/PHYSICS.md`.

- `RepairRequest.effectiveness` (0–1, default 1.0): drives the UI slider and is
  passed to `HH09ScenarioService.apply_repair(..., effectiveness=)`.
- `POST /api/scenarios/{id}/money` with `MoneyRequest {diagnosis_id,
  gas_price_pence_per_kwh?, repair_cost_gbp?}` → `MoneyResponse {diagnosis_id,
  estimate: MoneyEstimate | null, explanation}`. It re-prices a diagnosis this
  API returned, through `backend.engine.estimate_money` with `MoneyOverrides`.
  Non-confident diagnoses return `estimate: null` with an explanation.

### Error mapping

| Service exception | HTTP | `code` |
|---|---|---|
| `KeyError` (unknown scenario/diagnosis) | 404 | `NOT_FOUND` |
| `ScenarioStateError` (stale/duplicate action) | 409 | `INVALID_SCENARIO_STATE` |
| `ValueError` (invalid request for this scenario) | 422 | `INVALID_REQUEST` |
| `EngineDependencyError`, `WeatherContractError`, missing thresholds/data | 501 | `SERVICE_NOT_INTEGRATED` |

### Diagnostic thresholds

Mihir owns final thresholds. Until he publishes them, the API builds the
`DiagnosisController` from the provisional TRAINING-split Gate-2 values in
`reports/poc/poc_loop_results.json`. `HEATHUNTER_THRESHOLDS_PATH` may point to a
JSON file with `detection_bic`, `ambiguity_bic`, `adequacy_rmse`, `separation`,
`measurement_noise` and `note`. Every diagnosis discloses the values as
`ASSUMPTION` entries (`threshold_detection_bic`, `threshold_ambiguity_bic`,
`threshold_adequacy_rmse`, `threshold_separation`, `measurement_noise`).

### Guided scenario seed

A guided request without `seed` uses `GUIDED_DEMO_SEED = 68` (TRAINING split).
See `docs/DEMO.md` for how it was selected and the disclosed outcome rates.

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

Never create hand-written TypeScript copies of these interfaces. The frontend
imports types only from `frontend/src/api/schema.d.ts` via `frontend/src/lib/api.ts`.
