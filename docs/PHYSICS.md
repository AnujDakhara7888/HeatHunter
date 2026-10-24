# Mihir: HH09-inspired truth simulator and investigation services

This section documents the **simulation/diagnosis workstream only**. It does not
specify or replace Kailash's implementation of the public numerical engine.

## Scientific boundary

The simulated house is an approximate, deliberately assumed HH09-inspired
model. No result establishes that HH09 has a fault. Geometry and source-room
mapping come from `load_hh09_twin_inputs()`. No real indoor observations,
whole-house HTC, or blower-door numbers are used to generate synthetic room
observations. Measured HTC is not apportioned into per-room conductances.

The stable slots are Living Room (`living_room`), Kitchen (`kitchen`), Bedroom
(`bedroom_1`), and **Hall** (`bedroom_2`). Bathroom is outside the four-room model;
its omission is a simplification. Documented shared-boundary adjacency creates
one undirected coupling per pair; it does not establish an airflow path.

## Truth equations and assumed parameters

Each room has air temperature Ta and effective mass temperature Tm:

```
Ca dTa/dt = -(Hwindow + Hinfiltration) (Ta-To) - Ham (Ta-Tm)
            + sum_j Hij (Tj-Ta)
Cm dTm/dt = Ham (Ta-Tm) - Hwall (Tm-To)
ACH = L sqrt(0.025 |Ta-To| + 0.06 wind^2)
Hinfiltration = 0.33 [ACH volume + Qfan (L volume) / sum(L volume)]
```

The coefficient units are chosen so ACH is h^-1 with temperatures in degC and
wind in m/s. Stack/wind coefficients are empirical **ASSUMPTIONs**. This is not
an airflow pressure-network model. Inter-room exchange is symmetric, cancelling
from the total energy balance. Envelope conductance includes effective opaque
losses, including roof/floor losses; hallway envelope conductance is not a
claim that it has exposed exterior walls.

Base parameters, all **ASSUMPTIONs**, before independent uniform ±12% variation:

| Quantity | Assumed rule |
|---|---|
| Ca (J/K) | 1200 × assumed room volume (m³) |
| Cm (J/K) | 160000 × documented floor area (m²) |
| Hwindow (W/K) | 2.0 × documented window area (m²) |
| Hwall (W/K) | 1.8 × documented room floor area (m²) |
| Ham (W/K) | 12.0 × documented room floor area (m²) |
| L | 1.0 |
| Hij (W/K) | 1.85 W/m²K × shared boundary length × 2.4 m (plan-derived lengths) |
| Initial Ta | independent uniform 20–21 degC |
| Initial Tm | corresponding Ta minus uniform 0.3–1.0 degC |

The partition U-value is an ASSUMPTION because HH09's partition construction is
unpublished: ISO 6946 surface resistances (2 × 0.13 m²K/W), two 12.5 mm
plasterboard leaves (ISO 10456 gypsum, 0.25 W/mK) and an unventilated stud cavity
(0.18 m²K/W) give U ≈ 1.85 W/m²K. Boundaries come from Anuj's
`shared_boundaries` (five edges, including the Bedroom–Living chimney-breast
wall). That gives about 5–14 W/K per edge. Closed doors count as partition, and
door-gap airflow is neglected.

Volume retains Anuj's explicit 2.4 m ceiling-height assumption. These thermal
rules are illustrative inputs, not sourced HH09 measurements, inferred U-values,
or a calibrated real building. They must remain fixed while held-out tests run.
`build_house(seed, variation=...)` allows variation from zero to 15% for QA.

Request `severity` denotes an **excess multiplier**: physical parameter is
multiplied by `1 + severity`. Thus 0.6 means 1.6× and 3 means 4×. This reconciles
the frozen request's `0 < severity <= 3` with a maximum 4× leakage fault. Draft
changes L only; conduction changes Hwall only. Healthy truth is room null,
severity zero, even though the existing judge request requires room/severity
fields. No API schema was changed.

## Weather, integration and observations

Only `smeter-hh09-*` nights can create new scenarios. The internal adapter strips
known extra cache metadata and preserves notes/source and unknown coordinates.
Original NOAA resources are untouched. Training and held-out service instances
use disjoint source-night catalogs; an explicit override cannot cross that split.
Experiment weather must be a different night in the same split.

The eight-hour run is 22:00–06:00 GMT on the selected winter nights. The source
timezone assumption remains Anuj's documented assumption. Half-hourly measured
temperature/wind is linearly interpolated onto a common five-minute grid to
satisfy the frozen observation contract. Interpolated weather is labelled
`MODEL_ESTIMATE`, indoor readings `SIMULATED_MEASUREMENT`; cached source files
remain unchanged. Source `selection_metadata` still describes the original
25 half-hour samples, not the interpolated grid.

RK4 uses a maximum ten-second step by default (allowed 0.05–30 s). A conservative
outflow/capacity bound reduces the step for stiff rooms. Integration stops exactly
at fan switches and observation times. It rejects excessive stiffness/workload
rather than hanging, clipping temperatures, or returning unstable values. The
passive network's initial/external temperature bounds are checked at every step.

Sensor assumptions: five-minute samples, independent 0.15 degC Gaussian noise,
persistent per-room uniform ±0.3 degC offsets, 0.1 degC quantization, and 1%
dropouts. Dropouts may include the first/last sample. Independent SHA-256-derived
random streams separate house, scenario choice, offsets, measurement noise, and
dropout draws. Noise/dropout patterns are paired before/after repair. Same seed
and inputs reproduce output; opaque UUID scenario IDs intentionally differ.

## Exhaust-fan assumption

Default assumed delivered airflow is 84.950541 m³/h (50 cfm), not an HH09 fan
measurement. The scale is based on the intermittent bathroom exhaust example in
[PNNL Building America](https://basc.pnnl.gov/resource-guides/bathroom-exhaust-fans).
This American guidance is used only to choose a plausible hypothetical fan,
not to establish UK installation compliance. The fan runs for two hours.
Additional infiltration is split in proportion to each room's natural leakage
(leakage coefficient × volume), using actual scenario values.
The simplifying pressure assumption is shared with the public predictor and is
not independently validated by synthetic benchmark accuracy.

The displayed safety warning states that real depressurization can backdraft
some combustion appliances and requires appropriate safety assessment.

## Diagnosis boundary and Kailash handoff

`backend/diagnosis/controller.py` imports public contracts only, never simulator
physics, private parameters, seed, label or truth-store objects. Module import
isolation and input isolation are tested. This is a dependency boundary, not a
security sandbox against malicious code in the same Python process.

Kailash/integration provides a synchronous object implementing:

```python
fit_hypothesis(nights, room_id, template, cause: HypothesisType) -> HypothesisFit
predict_experiment(
    template, room_id, hypothesis_fits: tuple[HypothesisFit, HypothesisFit],
    weather_night, protocol, initial_temperatures: dict[str, float],
) -> tuple[Series, Series]
```

The prediction signature is the proposed internal adapter boundary; Kailash can
wrap his own functions without changing canonical API contracts. Predict both
competing **flagged-room** series on the supplied weather timestamps, in degC,
labelled `MODEL_ESTIMATE`. Forward-simulate coupled rooms together; future measured
neighbour temperatures are not available. Initial temperatures are assumed from
the first passive readings, never private simulator states. Missing initial
readings suppress the recommendation rather than substituting a later reading.

`DiagnosisController(engine, public_template, Thresholds(...))` compares normal,
draft and conduction fits. It checks adequacy **before** declaring no fault,
returns unexplained for inadequate fits or sparse data, uses BIC gaps for
ambiguity, and recommends E1 only when predicted RMS separation/noise passes
the configured threshold. Fit/prediction NaN, infinity, invalid units, mismatched
timestamps and implausible multiplier bounds are rejected. Money is not attached
to ambiguous/unexplained results. No fit score is displayed as a probability.

There are deliberately **no claimed trained default thresholds**. The controller
requires explicit thresholds. `calibrate_healthy_thresholds` provides conservative
95th-percentile healthy-training house-maxima for detection/adequacy; at least
20 known-healthy training cases are required, held-out weather rejected. Faulty
training runs must independently check adequacy and tune ambiguity. Calibration
of the public template belongs to Kailash. The old generic shared fixture template
is rejected by the HH09 scenario service because its names/volumes do not match.

## Nikhil service handoff

```python
from backend.simulation import HH09ScenarioService, GUIDED_SCENARIO_ID
service = HH09ScenarioService(controller, financial_estimator=optional_money_adapter)
```

The six async methods match `backend/app/services.py`: create, observations,
diagnose, experiment, repair, reveal. Nikhil must delegate the existing routes;
no app files, endpoints, schemas or TypeScript types were changed here.

Numerical work is offloaded to threads to keep the event loop responsive.
Per-instance locks serialize scenario mutation. Returned contracts are deep
copies. Experiment/repair results are cached by diagnosis ID for safe identical
retries. Failed refits/financial helpers commit no partial state. Unknown scenario
raises KeyError; invalid/stale actions raise ScenarioStateError/ValueError;
missing engine raises EngineDependencyError. Map these to appropriate API errors.
Once dispatched, a cancelled waiter does not abort a worker's atomic operation.

`hh09-guided-v1` is the new guided ID; `synthetic-guided-draft-01` is accepted as a
compatibility alias. The candidate guided scenario uses a fixed draft, **without
hardcoding its diagnosis or searching held-out seeds**. Its scientific demo success
is unverified until the actual public engine is connected.

Repair follows only a confident diagnosis. It changes only the predicted room
and path toward that particular house's healthy baseline. The hidden fault label
is not used to choose the repair. Full restoration is numerically exact. Same
initial conditions/weather/sensor streams give paired observations; public
remeasurement fits only repaired nights, never mixes pre/post-repair parameters.
Wrong-path and wrong-room repairs do not secretly restore another path.

The canonical RepairRequest has no effectiveness field; the API default is 1.0.
The service has an internal `effectiveness=` keyword in [0,1] for QA and future
approved integration. A frontend slider needs Nikhil's contract approval.

Optional financial adapter: `estimate(diagnosis) -> MoneyEstimate | None` and
`remeasure(original_nights, repaired_nights, diagnosis) -> float | None` (annual
kWh). It receives public observations/diagnoses only. Without it money stays
null, rather than manufactured. Negative/nonfinite annual outputs are rejected;
the frozen nonnegative energy field cannot communicate negative annual savings.
The repair text therefore also reports the **signed** paired temperature change,
which is not annual energy savings. Annual HDD/tariff assumptions must match the
new UK scenario; do not retain Long Island defaults without disclosure.

## Anuj evaluation handoff

Create separate `HH09ScenarioService(..., split=Split.HELDOUT)` instances. Internal
`weather_night_id` and `experiment_night_id` overrides on `create_scenario` allow
the harness to cover calm/windy nights; neither crosses the service split.
The API schema remains unchanged. `run_experiment(..., force_for_evaluation=True)`
supports an always-test baseline without falsifying the recommendation; never
expose this override in the normal UI. `discard(id)` explicitly releases memory;
the default capacity is 128 scenarios with no silent eviction. Evaluation may
call reveal to score answers; the diagnosis controller cannot access reveal.

## Open integration blockers (not silently bypassed)

1. HH09 cached weather has unpublished coordinates. The frozen Location schema
   requires numeric latitude/longitude. **Nikhil must approve and implement**
   `latitude: float | None = Field(default=None, ge=-90, le=90)` and the analogous
   longitude field, then regenerate OpenAPI/TypeScript. Until then canonical
   HH09 scenario creation raises an actionable WeatherContractError. The user
   requested that Nikhil be informed; this workstream leaves his schema untouched.
2. No `backend/engine/` implementation exists in this checkout. Numerical fitting,
   calibrated public template/thresholds, savings, genuine diagnostic PoC and
   held-out classification accuracy cannot be claimed yet.
3. Nikhil's existing routes still return 501 until he wires these services.

The metadata-independent `integrate_trajectory` accepts the actual station
temperature/wind series, so real-weather truth physics is tested without
fabricating coordinates or bypassing canonical response validation.

## Verification and break testing

```bash
.venv/bin/pytest
.venv/bin/ruff check backend
.venv/bin/python -m backend.simulation.qa --output /tmp/heathunter-physics-qa.json
```

QA covers analytic exponential decay, equilibrium, exact network energy balance,
RK4 convergence (including fan switches off the solver grid), actual HH09 forcing,
physical fault effects, fan airflow balance, exact full/partial/wrong repair,
sensor determinism/dropout extremes, stiff-parameter workload limits, malformed
weather, stale/cross-scenario IDs, duplicate concurrent actions, failed-action
rollback, mutation isolation, template mismatches, and async-loop responsiveness.

The standalone real-weather sweep covers 128 fault cases, all eight source
nights, two house seeds, four rooms, both fault types, and severities 0.6–3.0.
It runs 768 physical invariants. These are **physics checks**, not classification
accuracy or proof that the fan distinguishes causes. Scripted engines in tests
verify orchestration only and are never installed as a production fallback.

Two implementation defects were reproduced and fixed: last-bit residue after
100% repair, and synchronous numerical work blocking the async API loop. The
shared coordinate-schema incompatibility remains explicit rather than faked.

After engine/contract integration, call
`await backend.simulation.poc.run_poc(controller)` for a training-only actual
fitter PoC. It reports the observed outcomes without forcing success. Then run
Anuj's independent held-out benchmark. Never present the present scripted-engine
tests or truth-physics sweep as a successful diagnostic PoC.
