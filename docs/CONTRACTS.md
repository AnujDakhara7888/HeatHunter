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

## API v2: homes monitored night after night (implemented 2026-10-24)

Models: the "API v2" block of `backend/app/contracts.py`. Service:
`backend/app/monitoring_service.py` (shared logic), `backend/app/real_homes.py`
(storage and nights from uploads), `backend/simulation/demo_home.py` (the
hidden-fault demo house; truth stays there). Rule:
`backend/diagnosis/monitoring.py` (see the engine section of `docs/PHYSICS.md`).

Implementation notes:

- Each room is judged on its latest nights, at most **14** (the range the rule
  was tuned on). Rooms are scored in parallel worker processes;
  `HEATHUNTER_FIT_WORKERS` sets how many (`1` = in-process). About 0.2-0.8 s per
  demo night.
- A reported fix starts a fresh evidence window for that room: only nights from
  the fix onward are judged. The room is `resolved` once the latest 2 of them are
  healthy, and `still_an_issue` if the rule flags it again.
- Demo homes use the **held-out winter 2020-21** and live in memory (at most 32;
  the oldest are dropped). They support up to 28 nights.
- Real homes are saved as JSON in `HEATHUNTER_HOMES_DIR` (default `var/homes`,
  git-ignored) and reload on restart. A night counts only when every sensed room
  has readings within 30 min of both ends of the heating-off window, with no gap
  over 60 min. Its weather is fetched once from Open-Meteo for the home's
  coordinates and cached in the file. The flag rule's thresholds are
  transferred unchanged from the HH09 tuning; `/technical` discloses this as an
  ASSUMPTION.
- `DemoReveal` is returned by the reveal route only; a contract test enforces it.

### Idea in one paragraph

A **home** is watched night after night. After each heating-off night the
engine re-checks every room and gives it a plain status. When a room has a
problem, the app explains what and why, estimates the cost, and says what to
do. The repair is done by a person, in the room. The app then keeps watching
and confirms whether the problem has gone. Demo homes (the simulated HH09 twin
with a hidden fault) and real homes (sensor readings) use **the same routes**.
Only four routes are demo-only.

### Routes

| # | Method | Path | Who | Purpose |
|---|---|---|---|---|
| 1 | GET | `/api/homes` | all | House picker: list of homes |
| 2 | POST | `/api/demo/homes` | demo | Load any scenario: house + fault (or random, or none) |
| 3 | POST | `/api/homes` | real | Set up a real home: plan, location, heating-off hours |
| 4 | GET | `/api/homes/{home_id}` | all | Home health: every room's status in plain words |
| 5 | GET | `/api/homes/{home_id}/readings` | all | Chart data: room temps, weather, "expected if healthy" line |
| 6 | GET | `/api/homes/{home_id}/rooms/{room_id}` | all | One room: why, what to do, cost, evidence over nights |
| 7 | GET | `/api/homes/{home_id}/rooms/{room_id}/technical` | all | Fits, scores, thresholds (only when someone opens "details") |
| 8 | POST | `/api/homes/{home_id}/rooms/{room_id}/fix` | all | "I've fixed it": starts verification |
| 9 | POST | `/api/homes/{home_id}/readings` | real | Sensors upload readings |
| 10 | POST | `/api/demo/homes/{home_id}/advance` | demo | Move the demo clock on by N nights |
| 11 | GET | `/api/demo/homes/{home_id}/reveal` | demo | Show the hidden fault and whether the app got it right |
| 12 | POST | `/api/homes/{home_id}/assistant` | all | Chat about this home (Claude; sees public data only) |

Kept unchanged: `/api/health`, `/api/real/house`, `/api/real/house/floor-plan`,
`/api/homes/sample-plan`, `/api/assistant/floor-plan`, `/api/weather/lookup`.

**To be removed after the UI moves over:** `/api/scenarios/*` (diagnose,
experiments, money, repair, reveal), `/api/insight/*`, `/api/homes/analyze`,
`/api/homes/template`, `/api/assistant/chat`.

### Shapes (abridged; all fields `snake_case`, times UTC ISO)

### 1. `GET /api/homes` → `HomeSummary[]`
```json
{ "home_id": "demo-7f3a", "name": "HH09 twin (demo)", "kind": "demo",
  "status": "issue", "rooms_with_issues": 1, "nights_monitored": 5,
  "last_night": "2021-01-14", "created_at": "2026-10-24T20:00:00Z" }
```
`status`: `monitoring` (nothing found yet) · `issue` (at least one room
flagged) · `verifying` (a fix was reported, checking) · `all_clear`.

### 2. `POST /api/demo/homes`
```json
{ "house": "hh09",
  "fault": { "type": "draft", "room_id": "bedroom_1", "severity": 1.2 },
  "random_fault": false, "start_date": null, "seed": null }
```
`fault: null` with `random_fault: false` gives a healthy home. With
`random_fault: true`, the fault is hidden, random, and can be "none". Replaces
the guided, judge and surprise modes. Weather is the **held-out winter
2020-21**, so the demo is never scored on tuning data. Returns `HomeSummary`
with 0 nights. Call #10 to start the clock.

### 4. `GET /api/homes/{home_id}` → `HomeHealth`
```json
{ "home": { "...HomeSummary" },
  "rooms": [
    { "room_id": "bedroom_1", "name": "Bedroom",
      "status": "issue",
      "headline": "Losing about 35% more heat than expected, most likely through air leaks.",
      "likely_cause": "draft",
      "extra_heat_loss_percent": 35,
      "annual_cost_gbp": 48,
      "nights_seen": 5 },
    { "room_id": "kitchen", "name": "Kitchen", "status": "healthy",
      "headline": "Behaving as expected.", "likely_cause": null,
      "extra_heat_loss_percent": null, "annual_cost_gbp": null, "nights_seen": 5 } ],
  "disclaimer": "Screening estimate from an approximate model; not a certified audit." }
```
Room `status`:

| Status | Meaning |
|---|---|
| `not_enough_data` | No nights yet |
| `healthy` | Nothing unusual |
| `watching` | Looks unusual, waiting for a second night |
| `issue` | Problem and likely cause named |
| `issue_cause_unclear` | Problem found, cause not yet clear |
| `verifying` | A fix was reported, checking new nights |
| `resolved` | The fix worked |
| `still_an_issue` | The fix did not remove the problem |

`extra_heat_loss_percent` and `annual_cost_gbp` are shown only for `issue` /
`issue_cause_unclear`. Money is in GBP: the Ofgem price is the source, so no
USD conversion is needed in the UI.

### 5. `GET /api/homes/{home_id}/readings?from=&to=&room_id=`
```json
{ "outdoor_temperature": "Series", "wind_speed": "Series",
  "rooms": { "bedroom_1": { "measured": "Series", "expected_if_healthy": "Series" } },
  "nights": [ { "night_id": "hh09-night-2021-01-10", "start": "...", "end": "...",
                "mean_wind_m_s": 4.1 } ] }
```
`expected_if_healthy` is the engine's prediction for a healthy room under the
same weather (`MODEL_ESTIMATE`). It never comes from the simulator, so it
reveals nothing hidden.

### 6. `GET /api/homes/{home_id}/rooms/{room_id}` → `RoomReport`
```json
{ "room_id": "bedroom_1", "status": "issue", "headline": "...",
  "why": [ "It cooled faster than expected on 5 of 5 nights.",
           "The extra loss grew on windy nights, which points to air leaks rather than walls." ],
  "what_to_do": [ "Check window and door seals, loft hatch and pipe gaps.",
                  "Draught-proofing strips or sealant are usually enough." ],
  "money": { "annual_cost_gbp": 44.65, "annual_energy_kwh": 560.2, "repair_cost_gbp": 225.0,
             "payback_years": 5.0, "assumptions": [ "Assumption" ] },
  "evidence_by_night": [ { "night": "2021-01-10", "extra_heat_loss_percent": 22,
                           "threshold_percent": 12, "mean_wind_m_s": 4.1 } ],
  "suggested_check": null,
  "fix": null }
```
`suggested_check` is the optional fan test, offered only when the cause is
unclear and the engine predicts it would help. `fix` records the reported fix
and its verification result.

### 7. `GET …/rooms/{room_id}/technical` → `RoomTechnical`
Per hypothesis: multiplier, BIC, RMSE; the thresholds used; the settings'
provenance ("TRAINING-season simulation, not held-out"). Only fetched on demand.

### 8. `POST …/rooms/{room_id}/fix`
```json
{ "action": "seal_leaks", "fixed_on": "2021-01-15", "note": "Resealed the window" }
```
`action`: `seal_leaks` · `add_insulation` · `other`. The room becomes
`verifying`. Only nights **after** the fix are judged, and after enough of them
the room becomes `resolved` or `still_an_issue`. For a **demo** home, this also
applies the physical change to the simulated house, because the user is playing
the person doing the repair. Fixing the wrong thing honestly changes nothing.

### 9. `POST /api/homes/{home_id}/readings` (real homes)
```json
{ "room_temperature_series": { "bedroom": "Series" } }
```
Weather is fetched for the home's location (Open-Meteo). Complete heating-off
nights are added and every room is re-checked. Returns `HomeHealth`.

### 10. `POST /api/demo/homes/{home_id}/advance`
`{ "nights": 1 }` (1–14). Simulates the next nights and re-checks. Returns `HomeHealth`.

### 11. `GET /api/demo/homes/{home_id}/reveal` → `DemoReveal`
```json
{ "fault_type": "draft", "room_id": "bedroom_1", "severity": 1.2,
  "app_found_it": true, "nights_to_find": 2,
  "summary": "The hidden fault was an air leak in the Bedroom (2.2x normal). The app named it correctly after 2 nights.",
  "fault_free_twin": { "bedroom_1": "Series" }, "fault_free_night_id": "hh09-night-2020-11-09",
  "provenance": "SIMULATED_GROUND_TRUTH" }
```
`fault_free_twin` is the simulator re-run without the fault, for comparison.
It is shown only here, after the reveal. Allowed only once at least one night
exists. After reveal, the assistant may mention the truth.

### 12. `POST /api/homes/{home_id}/assistant`
`{ "messages": [ { "role": "user", "content": "Why the bedroom?" } ] }` →
`{ "reply": "...", "actions": [ { "type": "focus_room", "target": "bedroom_1" } ] }`.
The server builds the context from #4 and #6 itself, so the UI never sends
data. Claude only; returns 503 without an API key.

### Errors
404 unknown home or room · 409 wrong state (e.g. advance a real home, reveal
before any night) · 422 invalid input · 501 stale/missing settings ·
503 Claude or weather unavailable.

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
