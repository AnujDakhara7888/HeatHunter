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

No home, room, readings or assistant response contains the planted fault, its
severity, or private simulator coefficients; they stay inside
`backend/simulation/demo_home.py`. The flag rule receives only public templates,
observations and weather. No route returns the planted answer (the reveal
route was removed on 2026-10-25: in Judge mode the user chose the fault), and a
contract test keeps hidden truth off every route. The assistant never sees it.

The Real Homes response has no room-level fault label. Its disclaimer must state
that it demonstrates real measurements and does not validate synthetic
root-cause classification.

## HTTP surface

| Method | Path | Response | Notes |
|---|---|---|---|
| GET | `/api/health` | `HealthResponse` | |
| GET | `/api/homes` and the other API v2 routes | see "API v2" below | Demo and real homes |
| GET | `/api/real/house` | `RealHouse` | Real HH09 week (Real tab only; not monitored) |
| GET | `/api/real/house/floor-plan` | `image/png` | Original floor plan |
| GET | `/api/homes/sample-plan` | `HomePlan` | HH09 plan in the upload format |
| POST | `/api/assistant/floor-plan` | `FloorPlanDraft` | Claude reads an uploaded plan |
| POST | `/api/assistant/help` | `ChatReply` | General project help without a selected home; messages only |
| GET | `/api/weather/lookup` | `WeatherLookup` | Open-Meteo by place name |
| GET | `/api/evaluation/summary` | `EvaluationSummary` | 501 until the held-out report exists |

The single-night Fault Lab routes (`/api/scenarios/*`), `/api/insight/*`,
`/api/homes/template`, `/api/homes/analyze` and `/api/assistant/chat` were
removed on 2026-10-24 in favour of API v2. The simulator's
`HH09ScenarioService` and the single-night diagnosis controller remain in the
code base for research and evaluation, but no route serves them.

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
| 2b | GET | `/api/demo/weeks` | demo | Weeks a demo house can start on, with each week's real weather (mean °C, wind, windy/calm nights) |
| 3 | POST | `/api/homes` | real | Set up a real home: plan, location, heating-off hours |
| 4 | GET | `/api/homes/{home_id}` | all | Home health: every room's status in plain words |
| 4b | DELETE | `/api/homes/{home_id}` | all | Forget a home and its nights (a real home's file too); 204 |
| 5 | GET | `/api/homes/{home_id}/readings` | all | Chart data: room temps, weather, "expected if healthy" line |
| 6 | GET | `/api/homes/{home_id}/rooms/{room_id}` | all | One room: why, what to do, cost, evidence over nights |
| 7 | GET | `/api/homes/{home_id}/rooms/{room_id}/technical` | all | Fits, scores, thresholds (only when someone opens "details") |
| 7b | GET | `/api/homes/{home_id}/history` | all | Every room's status, cause, fits and cost after each night (analysis as of any past night) |
| 8 | POST | `/api/homes/{home_id}/rooms/{room_id}/fix` | all | "I've fixed it": starts verification |
| 9 | POST | `/api/homes/{home_id}/readings` | real | Sensors upload readings |
| 10 | POST | `/api/demo/homes/{home_id}/advance` | demo | Move the demo clock on by N nights |
| 10b | POST | `/api/demo/homes/{home_id}/fan-test` | demo | Run the next night as a fan test (only when a flagged room's cause is unclear; 409 otherwise) |
| 12 | POST | `/api/homes/{home_id}/assistant` | all | Chat about this home (OpenAI or Claude; server-built context) |

The single-night routes it replaced were removed on 2026-10-24 (see "HTTP
surface" above).

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
                "mean_wind_m_s": 4.1 } ],
  "insulation": { "envelope_u_w_per_m2k": { "bedroom_1": 0.742 },
                  "room_heat_loss_w_per_k": { "bedroom_1": 50.7 },
                  "default_envelope_u_w_per_m2k": 0.735, "window_u_w_per_m2k": 2.8,
                  "provenance": "MODEL_ESTIMATE", "notes": "..." } }
```
`expected_if_healthy` is the engine's prediction for a healthy room under the
same weather (`MODEL_ESTIMATE`). It never comes from the simulator, so it
reveals nothing hidden.

`insulation` (`SurfaceInsulation`, also on `GET /api/real/house` keyed by the
real sensor rooms) holds the engine's nominal figures: each room's envelope
conductance per m² of exposed wall, roof and floor (an effective U-value), its
nominal seasonal heat loss (what `extra_heat_loss_percent` is a fraction of),
and the SAP window U-value. The UI's infrared view uses them to estimate
surface temperatures from measured air and outdoor temperatures (ISO 6946
surface resistances). Those colours are estimates, not camera images.

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

### 10b. `POST /api/demo/homes/{home_id}/fan-test`
No body. Simulates the next night with a 2-hour extract fan and re-checks;
returns `HomeHealth`. Offered when `RoomReport.fan_test_available` is true (a
flagged room's cause is unclear). A fan night only helps name the cause; it
never flags a room (see `docs/PHYSICS.md`, "Fan test"). `NightInfo.kind` is
`fan_test` for it, and `RoomNightSnapshot.fan_test_nights` counts the fan nights
that helped name the cause.

### 12. `POST /api/homes/{home_id}/assistant`
`{ "messages": [ { "role": "user", "content": "Why the bedroom?" } ] }` →
`{ "reply": "...", "actions": [ { "type": "focus_room", "target": "bedroom_1" } ] }`.
The server builds the context from #4 and #6 itself, so the UI never sends
data. Set `HEATHUNTER_CHAT_PROVIDER=openai` and `OPENAI_API_KEY` for OpenAI;
the default `claude` uses `ANTHROPIC_API_KEY`. `HEATHUNTER_OPENAI_MODEL`
defaults to `gpt-5-nano` (minimal reasoning); the model setting is read after `.env` is loaded.
OpenAI uses the Responses API with strict JSON output, `store=false`, a
30-second request timeout, no automatic retries and at most 1,200 output tokens.
Only valid room-focus actions are used. Missing credentials, provider errors or
invalid replies return 503 with `ASSISTANT_UNAVAILABLE`; the UI labels its
local fallback as an offline explanation. Floor-plan reading remains Claude-backed.
Before a home is selected, the chat calls `/api/assistant/help` with the same
message-list request. Its context is server-owned and explicitly has no selected
home or room readings. Both chat paths include the project guide. No legacy
scenario endpoint or client-supplied house context is restored. Conversations
reset when the selected home changes; late replies from another session are ignored.
Both chat routes accept optional `screen` metadata: the page (`overview`, `fault_lab`,
`real_home`, `your_home`), 3D view, IR toggle, selected room ID, setup step and
timezone-aware chart window. These identify the visible UI; they cannot contain
client-supplied readings, diagnosis, prices or hidden truth. The backend adds the
selected room's public report or real HH09 measurement ranges for that window.
Ranges are explicitly not the current playback-cursor temperature. Page changes
also reset the conversation to prevent replies about a previous page.

### Errors
404 unknown home or room · 409 wrong state (e.g. advance a real home) ·
422 invalid input · 501 stale/missing settings ·
503 assistant or weather unavailable.

## OpenAPI and TypeScript

Export after any contract change:

```bash
python -m backend.app.export_openapi --output frontend/openapi.json
cd frontend && npm run generate:api
```

Never create hand-written TypeScript copies of these interfaces. The frontend
imports types only from `frontend/src/api/schema.d.ts` via `frontend/src/lib/api.ts`.
