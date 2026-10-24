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

## Mihir integration status — 2026-10-24

- Ready: `backend.simulation.HH09ScenarioService` implements the six canonical
  async service methods; API routes are intentionally untouched. Truth physics,
  hidden faults, sensor generation, E1, diagnosed repair, reveal and public-only
  diagnosis orchestration are implemented. See `docs/PHYSICS.md` for signatures.
- QA: 110 repository tests passed; Ruff passed. Real-weather physics sweep:
  128 cases, 768 checks, zero failures. This is not diagnosis accuracy.
- Blocker for Nikhil: canonical Location requires station coordinates that HH09
  does not publish. Please approve nullable latitude/longitude, regenerate types,
  and wire the existing routes. No coordinates were fabricated or schemas changed.
- Blocker for Kailash: inject the actual public fitter, coupled experiment
  predictor, HH09 public template and trained thresholds into DiagnosisController.
  Financial adapter is optional; unavailable money remains null. The genuine
  diagnostic PoC and classification benchmark have not run without this engine.
- Guided ID: `hh09-guided-v1`; old fixture ID retained as compatibility alias.
  Demo ambiguity/success is not hardcoded and remains numerically unverified.

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
- Scope change approved by Nikhil (2026-10-24): Three.js 3D twin and a
  Simple/Expert frontend view. Frontend-only; no API or science changes.
  Details in `docs/DEMO.md`.
