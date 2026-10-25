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
| POST | `/api/chat` | `ChatRequest` | `ChatResponse` | Nikhil (on-site assistant, optional) |

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

### On-site assistant (`POST /api/chat`)

This is a scope change approved by Nikhil on 2026-10-25: the frozen spec had
excluded chatbots. The endpoint is optional; without `ANTHROPIC_API_KEY` it
returns 503 `CHAT_UNAVAILABLE` and nothing else depends on it.

- **Request:** `messages` (alternating user/assistant turns, last one from the
  user) and an optional `page_context`. The page context is a plain-text
  summary of public, on-screen results; it never carries hidden truth before
  reveal and is treated as untrusted data.
- **Limits enforced by the server:**
  - questions of 600 characters or fewer;
  - only the last 12 turns are sent;
  - 15 messages per visitor per 10 minutes;
  - 300 messages per day across the whole site;
  - 700-token answers.

  The rate limits are configurable through `HEATHUNTER_CHAT_*` environment
  variables. A broken limit returns 422 `INVALID_REQUEST` or 429
  `RATE_LIMITED`.
- **Scope:** the rules live in `backend/app/chat_system_prompt.md`. The
  assistant answers only about HeatHunter, the visitor's check and home heat
  loss as the site covers it. It declines anything else, never guesses the
  hidden problem, and never invents numbers.
- **Model:** `claude-opus-5-5` (`HEATHUNTER_CHAT_MODEL`) at low effort, with
  server-side refusal fallbacks enabled.

### Error mapping

| Service exception | HTTP | `code` |
|---|---|---|
| `KeyError` (unknown scenario/diagnosis) | 404 | `NOT_FOUND` |
| `ScenarioStateError` (stale/duplicate action) | 409 | `INVALID_SCENARIO_STATE` |
| `ValueError` (invalid request for this scenario) | 422 | `INVALID_REQUEST` |
| `EngineDependencyError`, `WeatherContractError`, missing thresholds/data | 501 | `SERVICE_NOT_INTEGRATED` |
| Chat: over the per-visitor or daily allowance | 429 | `RATE_LIMITED` |
| Chat: no key, rejected key, no network | 503 | `CHAT_UNAVAILABLE` |

### Diagnostic thresholds

The API uses `backend.simulation.runtime.build_runtime_components()` once per
process. This is the same validated factory used by the simulator's offline
workflow. It loads `backend/diagnosis/decision_settings.json` and selects
`passive` rules for the initial night and `post_fan` rules for combined evidence.
The public template, controller, fan policy, and disclosed settings all come
from that one immutable configuration snapshot; no second settings read occurs.

`HEATHUNTER_THRESHOLDS_PATH` remains supported, but must now point to the complete
versioned settings document (both profiles, provenance, asset fingerprints and
fan policy). Old flat files and the historical PoC report are rejected, not used
as a fallback. Missing/malformed/stale settings return HTTP 501 for scientific
routes; health remains available. Changes to settings require process restart.

Every initial/updated diagnosis discloses its `decision_phase` and the actual
`threshold_detection_bic`, `threshold_ambiguity_bic`, `threshold_adequacy_rmse`,
`threshold_separation`, `measurement_noise`, `confidence_enabled`, and
`fan_max_wind_speed` as existing `ASSUMPTION` entries. The source labels these
as TRAINING calibration, not held-out or real-home validation. Fan eligibility
uses the existing calm-weather policy; this integration changes no coefficients.

### Guided scenario defaults

The API no longer injects a universal seed. Each guided ID uses its own manifest
when `seed` is omitted:

| Guided ID | Default seed | Purpose |
|---|---|---|
| `hh09-guided-insulation-v1` | 961029 | Curated TRAINING full loop: ambiguous → calm fan → identified wall heat loss → repair → no-fault recheck |
| `hh09-guided-v1` (also `synthetic-guided-draft-01`) | 20261024 | Draft uncertainty example; no forced confident result or repair |

An explicitly supplied `seed` is preserved. Such variations need not reproduce
the curated outcome. No seed, planted fault or private physics parameters are
passed to the diagnosis engine. See `docs/DEMO.md` for the exact API walkthrough.

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
