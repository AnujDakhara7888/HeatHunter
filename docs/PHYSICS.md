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

---

# Kailash: public diagnostic engine (`backend/engine/`)

This section documents the public model that diagnosis fits. It reads public
inputs only: the public template, observed temperatures, weather, protocol and
the sourced assumptions in `config/assumptions.json`. It never imports
`backend.simulation`, `backend.diagnosis` or the truth store, and
`backend/engine/tests/test_isolation.py` enforces that.

Update to the blockers listed above: the null-coordinate contract change (item 1)
is in commit `[contract fix for Nikhil review]`. Item 2 is resolved by this
engine.

## Model

Each room has **one dynamic temperature**, its fabric (walls, furniture, mass)
`T_f`. The measured room air is a quasi-steady layer between the fabric and the
incoming outdoor air (SI units):

```
H_air(t)   = m_l H_inf0 f(w, dT) + fan(t) 0.33 Q share
H_ser      = H_af H_air / (H_af + H_air)                 (air path in series)
C dT_f/dt  = -[m_c H_cond + H_ser] (T_f - T_out) + sum_j H_ij (T_f,j - T_f)
T_air      = T_f - H_air/(H_af + H_air) (T_f - T_out)     (what sensors read)
share_i    = m_l,i s_i / sum_j m_l,j s_j                  (spec's leakage-share rule)
f(w, dT)   = sqrt((dT + (Cw/Cs) w^2) / dT_ref)           (ASHRAE/LBL stack + wind)
```

Without the engine extension (`H_af = inf`, linear `f = 1 + beta w`) this is
exactly the specification's single-node model, and tests check that limit. Two
evidence-driven extensions were agreed with Kailash:

1. **Quick-settling air layer.** In the simulator, the fan dips room air by
   about 1 °C within minutes and the air rebounds when the fan stops, while the
   fabric barely moves. A single-node model cannot represent this, and every
   post-test fit was "unexplained". `H_af` is calibrated on healthy TRAINING
   fan nights.
2. **Stack effect.** Leakage also depends on the indoor-outdoor difference.
   This uses the published ASHRAE/LBL coefficients (one-storey, shelter class
   3), deliberately not the simulator's. The stack term uses the room's own
   measured temperature, so fitting stays linear and fast.

Both live in the engine-owned `templates/hh09_model_extension.json`, keyed by
`template_id`, because the canonical `PublicTemplate` contract has no fields for
them. Engine functions load it automatically when the template ID matches.

## Calibration (`calibrate_public_template`)

- **Inputs:** healthy, simulated, TRAINING-split observations only. 40 houses
  (seeds 910000–910039), each with four passive nights and two fan nights (one
  calm, one windy). Held-out weather, real measurements and missing fan nights
  are rejected.
- **Absolute-scale anchor:** C = SAP 2012 Table 1f "medium" TMP 250 kJ/m²K ×
  documented floor area + air capacity. Cooling data only reveals loss/capacity,
  so this anchor fixes the W/K units.
- **Per-house joint fit:** H_cond and H_inf0 per room, one air-fabric
  coefficient per house, plus nuisance start temperatures and sensor offsets.
  The nominal template is the median over houses.
- **Inter-room coupling is fixed, not fitted:** U = 2.5 W/m²K (ISO 6946
  plastered dense blockwork) × plan-derived wall area. Passive cooling cannot
  identify coupling (free fits swung from 0.05 to 225 W/K), and the exterior
  estimates barely change for U between 1.2 and 2.5. The value deliberately
  differs from the simulator's 1.85 to avoid the inverse crime.
- **Result:** per-house RMSE is 0.158 °C (noise is 0.15) and all 40 houses
  converged. The air-fabric coefficient is 15.4 W/m²K (IQR 14.9–15.8). The
  four-room total at season-mean wind is 136 W/K, against HH09's measured
  172 W/K for the whole dwelling including the bathroom; that is a reference
  check only.
- **Reproduce:** `python -m scripts.calibrate_public_template --houses 40`, about
  2 minutes. Report: `templates/hh09_calibration_report.json`.

## Hypothesis fitting (`fit_hypothesis`)

- **Per-room fit:** each room is fitted separately with SciPy bounded
  `least_squares`. Neighbours enter through their *measured* temperatures.
- **Hypotheses:** normal (all multipliers exactly 1), draft (`m_l` in [0.3, 6])
  and envelope conduction (`m_c` in [0.3, 6]). The bounds are agreed with the
  controller.
- **Shared nuisance parameters:** every hypothesis also fits one start
  temperature per night and one sensor offset (±0.5 °C) per room, so BIC
  values are comparable.
- **BIC:** `n ln(SSE/n) + k ln n`. It is a fit score, not a probability.
- **Skipped readings:** the first 15 minutes of each night (start transient) and
  10 minutes after each fan switch (air settling). Missing readings are
  skipped, with warnings.
- **Speed:** about 0.1 s for the 12 fits of one diagnosis.
- **Detailed variant:** `fit_hypothesis_detailed` also returns warnings,
  observation and parameter counts, the fitted offset and start temperatures.

## Experiment prediction (`predict_experiment`)

All rooms are forward-simulated together under each competing fit, starting
from the observed first readings. The output is `MODEL_ESTIMATE` series on the
experiment weather timestamps. The signature matches the controller's adapter
protocol (`PublicModelEngine`).

## Money (`estimate_money`, `PublicMoneyEstimator`)

Excess conductance is `(m − 1) H_cond` for conduction. For a draft it is the
series air-path increase at the season-mean wind (2.97 m/s, SMETER station)
and dT_ref. Then:

```
gas_kWh  = excess x HDD x 24 / 1000 / efficiency
cost_USD = gas_kWh x price x GBP->USD
payback  = repair_cost / annual cost
```

Inputs (all in `config/assumptions.json`):

| Input | Value | Source |
|---|---|---|
| Heating degree days | 1,722 K·day | Base 15.5 °C, computed from the SMETER station's real 2020 data |
| Boiler efficiency | 86.7% | HH09's documented winter seasonal value |
| Gas price | 7.97 p/kWh | Ofgem price cap, Oct–Dec 2026 |
| Exchange rate | 1.3363 USD/GBP | Bank of England, 22 Oct 2026 |
| Repair costs | illustrative | **UNVERIFIED**, user-adjustable; flagged in every returned assumption |

`MoneyOverrides` supports the tariff and repair-price controls. Ambiguous,
unexplained or non-excess results return `None`. Re-measured savings come only
from refitting the public before/after observations.

## Gate-2 proof of concept (`scripts/poc_loop.py`)

The PoC runs on the TRAINING split; the held-out benchmark is Anuj's. Its
thresholds are **provisional PoC tuning**, and Mihir owns the final values:

| Threshold | How it was set | Value |
|---|---|---|
| Detection | Healthy passive cases, 95th percentile | 114 |
| Fit quality | Larger of healthy p95 (0.177) and correct-model p95 on faulty training (0.264) | 0.264 °C |
| Ambiguity | Smallest passive BIC gap with ≥95% precision on 48 faulty training scenarios | 51.6 |

Scenario, tuning and calibration seeds are disjoint.

Findings (actual numbers, `reports/poc/poc_loop_results.json`):

- **Conduction faults** are identified correctly on a passive night: 24/24 end
  to end. A draft cannot mimic a fabric conduction loss.
- **Drafts are genuinely ambiguous on a passive night.** A conduction
  multiplier reproduces the draft curve, and the ±12% house variation looks
  conduction-like. With a lenient ambiguity threshold, this produced confident
  wrong "conduction" answers.
- **GO, with a condition.** The fan test discriminates draft vs conduction
  under some conditions but not others. Draft ranked first after passive + fan:
  - 7/8 with the calm 2020-12-06 fan night;
  - 4/8 with the calm 2019-12-01 fan night;
  - 4–7/8 with windy fan nights. The windy fan night on its own ranks the draft
    first in only 0–2/8, because the published wind coefficients differ from
    the simulator's.
  - Overall: 32/48 across all pairings.
- **End to end:** drafts are 6/24 correct, healthy false alarms 3/8, and
  repairs address the true cause in 25/37.
- **Proposal for Mihir:** run E1 only on calm nights. ISO 9972 fan-pressurisation
  practice limits meteorological wind to about 6 m/s (3 m/s at ground level).
  Use per-context thresholds (passive vs passive + fan) and tune ambiguity on
  faulty training scenarios.

## Proposed contract changes (for Nikhil; not implemented)

- `RepairRequest.effectiveness` (0–1), so the UI slider works. The service
  currently takes it only as a keyword argument.
- Optional `gas_price_pence_per_kwh` / `repair_cost` overrides on diagnose and
  repair, so the money controls reach `MoneyOverrides`.
- `RoomTemplate.air_fabric_conductance_w_per_k` and a leakage-law field, to
  replace the engine-side extension file.
- Replace the stale `shared/fixtures/public_template.json` with the calibrated
  HH09 template.
