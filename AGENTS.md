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
  engine, money adapter and offline phase-specific decision profiles. Nikhil
  should share one instance across the six existing scenario routes.
- Canonical coordinate blocker is resolved. API/UI wiring and Anuj's independent
  held-out benchmark remain owned by their respective contributors.
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
- QA: 188 repository tests pass; Ruff passes. Reported limitations, exact seeds,
  weather IDs, saved profiles, failure records and reproduction commands are in
  Mihir's section of `docs/PHYSICS.md` and `backend/simulation/reports/`.
- API contracts/routes, public-engine implementation, data-pipeline code and
  Kailash's section of PHYSICS.md were not modified by this workstream.
