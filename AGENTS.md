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
