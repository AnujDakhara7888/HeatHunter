# HeatHunter collaboration rules

The frozen product specification and scientific provenance rules are binding.
Do not silently change another contributor's interfaces or implementation.

## Ownership

- **Anuj:** `backend/data_pipeline/`, `backend/evaluation/`, `data/`,
  `docs/SMETER_INVENTORY.md`, `docs/EVALUATION.md`, submission technical copy.
- **Kailash:** `backend/engine/`, public model calibration and savings functions.
- **Mihir:** `backend/simulation/`, `backend/diagnosis/`, scenario state, experiments,
  repairs, and hidden truth storage.
- **Nikhil:** `backend/app/`, `frontend/`, `shared/fixtures/`, `docs/CONTRACTS.md`,
  `docs/DEMO.md`, API and UI integration.

The current Anuj workstream is explicitly also establishing Nikhil's repository,
contract, and fixture foundation by team agreement. Future contract changes need
integration-owner review.

## Invariants

1. Never pass `GroundTruth` or private simulator parameters to diagnosis code.
2. Never serve ground truth before the reveal endpoint.
3. Preserve UTC ISO timestamps, documented units, and allowed provenance values.
4. Real-home data has no verified room-level fault labels.
5. Do not present synthetic evaluation as field validation.
6. Keep the judge demo free of live network dependencies.
7. Regenerate TypeScript types from OpenAPI; do not create parallel interfaces.

## Mihir integration status — 2026-10-24 (updated)

- Ready: `backend.simulation.runtime.build_scenario_service()` loads the actual
  engine, money adapter and offline phase-specific decision profiles. API wiring
  now shares the same configuration via `build_runtime_components()`; see the
  backend integration follow-up below.
- Canonical coordinate blocker is resolved. Frontend example/copy integration
  and Anuj's independent held-out benchmark remain with their owners.
- Reviewed the volume-weighted fan split and geometric inter-room coupling;
  their assumptions remain explicit. No physics coefficients were changed here.
- Fan eligibility now checks max station wind <=2 m/s over the two-hour interval,
  rejects bad/missing data and windy overrides, and cannot be bypassed by the
  always-test evaluation flag. Windy passive nights remain supported.
- Saved profiles: `backend/diagnosis/decision_settings.json`. Separate passive
  and post-fan decisions were tuned on 344 TRAINING cases and checked on 94
  further TRAINING cases. Empirical confident precision: 19/19 and 28/28;
  healthy false alarms 0/30 each. These are conditional finite-sample counts,
  not overall/held-out/real-home accuracy. No draft had a correct confident
  classification in that fresh check; uncertainty and misses remain visible.
- Guided full flow: `hh09-guided-insulation-v1`, explicitly curated from training.
  Existing `hh09-guided-v1`/legacy draft alias retain an unresolved draft example.
  Actual-engine integration tests verify full diagnosis/test/money/repair/reveal.
- QA: 205 repository tests pass after API integration; Ruff passes. Reported limitations, exact seeds,
  weather IDs, saved profiles, failure records and reproduction commands are in
  Mihir's section of `docs/PHYSICS.md` and `backend/simulation/reports/`.
- The original simulator-only handoff did not modify API contracts/routes.
  The follow-up below wires existing routes under the user's explicit request;
  public-engine/data-pipeline code and Kailash's PHYSICS.md section are unchanged.

## Nikhil integration status — 2026-10-24

- All routes delegate to `HH09ScenarioService`, `PublicModelEngine`,
  `PublicMoneyEstimator` and `load_real_house` (`backend/app/runtime.py`).
  Thresholds are the provisional Gate-2 TRAINING values from
  `reports/poc/poc_loop_results.json` (disclosed on every diagnosis); Mihir can
  supply final values via `HEATHUNTER_THRESHOLDS_PATH` without code changes.
- Approved contract changes: `RepairRequest.effectiveness`;
  `POST /api/scenarios/{id}/money` (Kailash `estimate_money` overrides);
  `GET /api/real/house/floor-plan`. Types regenerated.
- Still 501: `/api/evaluation/summary` until Anuj writes
  `reports/evaluation/summary.json`.
- Finding for Mihir/Kailash: for the guided fault (draft, Bedroom, ×3.0) the
  final diagnosis matched in 3/120 TRAINING seeds. All 22 confident-but-wrong
  results chose conduction after the fan test
  (`shared/fixtures/guided_seed_scan.json`).

## Mihir backend integration follow-up — 2026-10-24

This supersedes the provisional threshold and universal seed-68 instructions in
Nikhil's earlier integration status above. The user explicitly requested the API
configuration/seed integration while leaving UI work paused and uncommitted.

- API startup now calls `build_runtime_components()` once. Its scenario service,
  template, phase profiles and fan policy come from the same validated snapshot.
  The compatible `build_scenario_service()` API remains available for evaluation.
- Existing endpoint paths, Pydantic contracts and generated OpenAPI/TS schemas
  are unchanged. Every diagnosis discloses the actual passive/post-fan settings.
- `HEATHUNTER_THRESHOLDS_PATH` now requires a full versioned settings document;
  legacy flat files, stale assets and malformed settings fail explicitly with 501.
- Removed the blanket guided seed override. Insulation uses its manifest seed
  961029; the original draft uses 20261024; explicit caller seeds are retained.
- QA: 205 tests pass, Ruff and diff checks pass. Actual HTTP checks through the
  local frontend proxy verified both scenarios after backend restart: insulation
  ambiguous → fan → correct conduction → repair (+1.043°C paired mean) → no-fault
  recheck → matching reveal; draft remains unresolved with no money or repair.
  These are selected TRAINING integration checks, not held-out accuracy.
- No frontend source was edited during this integration step. The current UI
  default still selects the draft example. Nikhil should expose the separately
  labelled insulation example and refresh historical calibration/seed-scan copy.
- Anuj's held-out evaluation remains pending. No model coefficients or saved
  decision cutoff values were changed by the API integration.

## API v2 and route removal — 2026-10-24 (Kailash)

This supersedes the route descriptions in the integration notes above.

- The product now monitors homes night after night: see "API v2" in
  `docs/CONTRACTS.md`. Demo homes (`backend/simulation/demo_home.py`) keep their
  planted fault private. Only `GET /api/demo/homes/{home_id}/reveal` returns it.
- Removed routes: `/api/scenarios/*`, `/api/insight/*`, `/api/homes/template`,
  `/api/homes/analyze` and `/api/assistant/chat`. The frontend must move to
  API v2. `HH09ScenarioService`, the single-night controller and
  `decision_settings.json` remain for research; no route serves them.
- The multi-night flag rule (`backend/diagnosis/monitoring.py`) and its settings
  fingerprint the engine assets. After any engine change, rerun
  `backend.simulation.monitoring_study` and `backend.simulation.tune_monitoring`.
