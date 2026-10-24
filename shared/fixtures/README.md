# Synthetic integration fixtures

Every JSON file in this directory is intentionally synthetic and validates
against the named canonical Pydantic model. These values are for development and
contract testing only; they are not measurements, benchmark results, calibrated
parameters, repair prices, or scientific claims.

Fixtures never mix hidden `GroundTruth` into public scenario or observation
payloads. Owners may use them before other modules are implemented, then replace
them with real service outputs at integration boundaries.

| File | Contract |
|---|---|
| `scenario_create_request.json` | `ScenarioCreateRequest` |
| `scenario_created.json` | `ScenarioCreated` |
| `public_template.json` | `PublicTemplate` |
| `night_observations.json` | `NightObservations` |
| `diagnosis.json` | `Diagnosis` |
