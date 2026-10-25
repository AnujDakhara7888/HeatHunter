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

Phase-specific settings now live in `backend/diagnosis/decision_settings.json`.
`DecisionProfiles` selects passive settings for one passive night, and post-fan
settings for one passive plus one fan night. Other combinations are rejected
because they were not calibrated. Legacy callers can still supply a single
`Thresholds` object, but the supported offline factory uses the saved profiles.

The conservative training workflow is reproducible with:

```bash
.venv/bin/python -m backend.simulation.train_decisions \
  --cache /tmp/hh09-training-fits.json --refine-on-training-check --second-refinement
```

It uses 344 tuning cases (120 healthy, 224 faulty) and a fresh 94-case TRAINING
check (30 healthy, 64 faulty). Earlier TRAINING-check cases were explicitly
promoted into tuning during refinement; they are not advertised as independent
validation. Seeds remain separate from public-template calibration and all
weather is from the four-night training partition. Passive nights cover both
calm and windy conditions; fan nights are calm only. Severity, room and weather
choices are not tied by array index. No held-out sensor observations or fault
labels participate in selection.

The joint room/cause cutoff search tries healthy house-max BIC p99 times
{1.1, 1.25, 1.5, 2}, and candidate cause gaps. It prefers the highest empirical
supported precision, then coverage, with at least 12 confident tuning cases.
Adequacy includes healthy and true-fault training residuals. The separate fresh
TRAINING check disables confidence if precision is below 95%, healthy false
alarms exceed 5%, or supported sample size is below 12. This is a finite-sample
operating rule, not a guaranteed population error rate or a probability shown
in the UI. The separation/noise floor remains the documented heuristic 2.0;
recommendation never guarantees resolution.

On the final fresh check, confident answers were correct in 19/19 passive and
28/28 post-fan cases, with 0/30 healthy false alarms in each phase. Coverage is
limited: none of 32 draft cases received a correct confident diagnosis in either
phase. Post-fan confident coverage was only 28/94 cases overall. No-fault and
unresolved outcomes must remain visible. Do not describe these conditional
precision counts as overall accuracy, real-world validation or a held-out
benchmark. Post-fan checks supplied both nights to all cases; they do not
represent the recommendation-only policy. Full seed, weather, planted-fault and
outcome details are in `backend/simulation/reports/decision_training_report.json`.

A higher post-fan threshold cannot by itself erase a passive anomaly: the
controller rechecks the passive observations and returns `unexplained` if that
anomaly remains while joint evidence falls below the post-fan cutoff. Repaired
observations are independently refitted and can legitimately return `no_fault`.

## Calm fan operating policy

`CalmFanPolicy` uses a project-assumed maximum 2.0 m/s during the actual two-hour
fan interval, including samples bracketing interpolated endpoints. It rejects
missing, nonfinite, negative or sparse wind data. This uses remote station
half-hour averages, not house-site gusts. It is NOT ISO 9972 compliance or a
validated real-home temperature-test acceptance limit. ISO 9972:2015 §5.1.1
concerns pressure-test conditions and distinguishes near-ground and meteorological
wind; it does not establish our thermal test's cutoff.
Reference: https://preview.sist.si/sist-preview/55718/618cb285e8bc49c393f5e6db071dbca6/ISO-9972-2015.pdf

Scenario creation chooses a different eligible night in the same split. Windy
passive nights remain allowed. Explicit windy fan overrides are rejected; if no
eligible alternative exists, the house can still be investigated and the test is
deferred. Execution rechecks eligibility, including for always-test evaluation
requests. A forced evaluation flag cannot bypass the weather restriction.

A paired protocol study is reproducible with:

```bash
.venv/bin/python -m backend.simulation.compare_protocols
```

For 16 known-room TRAINING cases at severity 2, correct leading causes were:
passive 9/16; two passive nights 9/16; calm fan 15/16; windy fan 10/16. The calm
fan and second-passive controls share weather, initial conditions and sensor
streams. This isolates the intervention's contribution for this small sample,
not room detection, confident diagnosis, general accuracy, or field validity.
Its complete output is in
`backend/simulation/reports/paired_protocol_comparison.json`.

## Nikhil service handoff

```python
from backend.simulation.runtime import build_scenario_service
service = build_scenario_service()
```

The six async methods match `backend/app/services.py`: create, observations,
diagnose, experiment, repair, reveal. The API now delegates through
`build_runtime_components()`, which supplies the same service plus its exact
public template, saved profiles and fan policy for accurate disclosures. The
existing `build_scenario_service()` entry point remains compatible. Endpoints,
request/response contracts and generated TypeScript schemas are unchanged.

Numerical work is offloaded to threads to keep the event loop responsive.
Per-instance locks serialize scenario mutation. Returned contracts are deep
copies. Experiment/repair results are cached by diagnosis ID for safe identical
retries. Failed refits/financial helpers commit no partial state. Unknown scenario
raises KeyError; invalid/stale actions raise ScenarioStateError/ValueError;
missing engine raises EngineDependencyError. Map these to appropriate API errors.
Once dispatched, a cancelled waiter does not abort a worker's atomic operation.

`hh09-guided-insulation-v1` is the explicitly disclosed, TRAINING-selected full
flow example (seed 961029, Hall, conduction excess multiplier 1, passive weather
2020-12-06 and fan weather 2019-12-01). It genuinely produces ambiguous →
recommended calm fan → correct confident conduction → repair → no-fault recheck.
It is a curated demo, not an evaluation sample. `hh09-guided-v1` and legacy
`synthetic-guided-draft-01` retain the original draft scenario; under conservative
settings it stays unresolved. No result is hardcoded. Request seed/weather
overrides create variations whose outcomes are not guaranteed. Judge and surprise
modes continue to display whatever the engine actually concludes.

The factory loads the actual public model, money adapter and saved phase
profiles entirely offline. It checks template ID and fingerprints of the public
model, simulator/twin, operating policy and training weather before starting.
Stale calibration fails explicitly. No private truth, scenario seed or hidden
parameters are passed into the diagnosis engine.

Repair follows only a confident diagnosis. It changes only the predicted room
and path toward that particular house's healthy baseline. The hidden fault label
is not used to choose the repair. Full restoration is numerically exact. Same
initial conditions/weather/sensor streams give paired observations; public
remeasurement fits only repaired nights, never mixes pre/post-repair parameters.
Wrong-path and wrong-room repairs do not secretly restore another path.

Nikhil's approved `RepairRequest.effectiveness` field is integrated; the API
passes it to the service's `effectiveness=` keyword in [0,1], defaulting to 1.0.
The existing slider can therefore test partial repairs without a schema change
in this workstream.

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

## Resolved and remaining integration work

Resolved: nullable coordinates are in the canonical contract; actual HH09
observations now validate. Kailash's fitter, calibrated public template,
experiment predictor and money adapter are present and used by the offline
factory. Separate decision settings are now saved and validated.

API integration is complete locally: `backend/app/runtime.py` shares the
validated configuration across the existing routes, discloses phase-specific
rules, and rejects missing/stale/legacy flat settings without a provisional
fallback. Each guided ID now retains its manifest seed; explicit caller seeds
are preserved. The approved effectiveness field is present.

Nikhil still owns the user-facing selection of the labelled insulation example
and replacement of historical provisional calibration/seed-scan copy. The UI
has intentionally not been edited during this backend integration step. The
existing default UI example remains the honest unresolved draft case.

Anuj owns the independent >=60-case held-out benchmark. Use the frozen offline
factory with `split=Split.HELDOUT`, judge/surprise cases and separate seeds; never
count curated guided examples as benchmark evidence. Always-test baselines obey
the calm policy. After held-out evaluation, report failures rather than tuning
these settings on that partition.

Kailash and Mihir should continue investigating the underlying draft/conduction
bias: confidence remains poor for drafts even under calm conditions. Thresholds
trade coverage for fewer wrong repairs; they do not solve this model mismatch.

## Documented failure cases

- Passive drafts often resemble conduction; earlier training checks contained
  confident wrong answers and wrong-room selections. The final finite fresh
  check had none among its confident answers, which does not establish general
  reliability. No draft received a supported confident classification in that
  check. This remains a screening prototype.
- Mild faults may lie inside healthy thermal-property/sensor variation and be
  reported `no_fault`. This means no supported significant anomaly, not proof
  that the building is healthy. False negatives are explicitly reported.
- Windy fan nights were less discriminating in the paired study and are deferred.
  Natural wind remains useful as passive evidence and for the documented fallback.
- Missing initial sensor readings prevent fair test prediction; no test is
  recommended rather than substituting a later, cooler temperature.
- A passive anomaly that fails the higher combined threshold is unresolved, not
  a verified repair or an automatic all-clear.
- The original guided draft remains unresolved; the labelled insulation example
  is used for the full repair story with explicit curation disclosure.

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

The original `scripts/poc_loop.py` remains a historical provisional PoC, not the
source of the final offline profiles. The new factory and protocol/training
commands above reproduce the supported configuration. The legacy helper
`await backend.simulation.poc.run_poc(controller)` remains available for a
training-only actual-fitter PoC. It reports the observed outcomes without forcing success. Then run
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
`T_f`. The measured room air `T_a` is a quasi-steady layer between the fabric,
the incoming outdoor air and the neighbouring rooms' air (SI units):

```
H_air(t)   = H_win + m_l H_inf0 f(w, dT) + fan(t) 0.33 Q share
0          = H_af (T_f - T_a) - H_air (T_a - T_out) + sum_j H_ij (T_a,j - T_a)
C dT_f/dt  = -m_c H_cond (T_f - T_out) - H_af (T_f - T_a)
share_i    = m_l,i s_i / sum_j m_l,j s_j                  (spec's leakage-share rule)
f(w, dT)   = sqrt((dT + (Cw/Cs) w^2) / dT_ref)           (ASHRAE/LBL stack + wind)
```

Without the engine extension (`H_af = inf`, no separate window path, linear
`f = 1 + beta w`) this is exactly the specification's single-node model, and
tests check that limit. Four evidence-driven extensions were agreed with
Kailash:

1. **Quick-settling air layer.** In the simulator, the fan dips room air by
   about 1 °C within minutes and the air rebounds when the fan stops, while the
   fabric barely moves. A single-node model cannot represent this, and every
   post-test fit was "unexplained". `H_af` is calibrated on healthy TRAINING
   fan nights.
2. **Stack effect.** Leakage also depends on the indoor-outdoor difference.
   This uses the published ASHRAE/LBL coefficients (one-storey, shelter class
   3), deliberately not the simulator's. The stack term uses the room's own
   measured temperature, so fitting stays linear and fast.
3. **Windows on the air side (2026-10-24).** Glass has negligible thermal mass,
   so glazing cools the room air directly, in parallel with infiltration:
   `H_win` = SAP 2012 Table 6e double-glazed, air-filled, 12 mm gap, PVC/wood
   frame, 2.8 W/m²K (p. 217) × documented window area. HH09 is documented only
   as "Double glazing"; SAP says to assume air-filled without low-E. Fixed, not
   fitted, and deliberately not the simulator's own coefficient. A draft
   multiplier scales infiltration only, never the glazing.
4. **Air-to-air inter-room coupling (2026-10-24).** A partition U-value is
   defined between the air on either side (it includes both surface
   resistances), so coupling acts on the air balance, not the fabric. The
   per-room fit uses neighbours' *measured* air directly, with no neighbour
   parameters. A leaky room's air sits well below its fabric and is partly held
   up by warmer neighbouring air; the fabric-to-fabric version missed this.
   A test checks the quasi-steady network against an independent two-node ODE
   with a very light air node (agreement within 0.02 °C).

`H_af`, the leakage law and `H_win` live in the engine-owned
`templates/hh09_model_extension.json`, keyed by `template_id`, because the
canonical `PublicTemplate` contract has no fields for them. Engine functions
load it automatically when the template ID matches.

### Why air leaks were missed, and what fixes it (2026-10-24)

Controlled fits of simulator houses (scratch probes, not committed) showed:

| Evidence (realistic noise, ±12% houses, 4 houses × 4 rooms × 2 severities) | Drafts correct | Conduction correct |
|---|---|---|
| One calm night | 3/32 | 32/32 |
| Four passive nights (2 calm, 2 windy) | 30/32 | 32/32 |

On one calm night a draft and an envelope fault cool a room almost identically.
Leak heat loss rises with wind and wall loss does not, so several nights of
varying weather separate them. The main fix is therefore **evidence
accumulated over several nights**, not a change of model structure. The window
path and air-to-air coupling are physics corrections: on noise-free data they
recover envelope-fault size closely (×2 → 2.0–2.3, ×4 → 4.1–4.6 versus 1.8 and
3.9 before), but they did not change classification on realistic data.
Rejected hypotheses: the SAP capacitance anchor (matching the simulator's mass
made the fan fit worse) and the leakage-law ratio (matching it barely changed
the fits).

Open issue: on a fan night the draft hypothesis still mispredicts severe (×4)
drafts in the large rooms, so passive + fan can rank them as conduction. The
fan is therefore an optional suggested check, not the main evidence.

## Multi-night monitoring rule (`backend/diagnosis/monitoring.py`)

The product monitors a home over consecutive heating-off nights instead of
judging one night. `assess_rooms(nights, template, settings)` returns, for every
room, `healthy`, `watching` (suspicious, not yet persistent), `issue` (room and
cause named) or `issue_cause_unclear`.

- **Measure.** For each room, all nights so far are fitted together under
  normal, draft and envelope conduction. The leading fault's *excess heat loss*
  is its extra seasonal conductance as a fraction of the room's nominal seasonal
  heat loss (`engine.excess_fraction`). This is the number a user sees ("this
  room loses 30% more heat than expected").
- **Threshold per cause, strict early.** A room is a candidate when the excess
  exceeds `a + b / sqrt(nights)` for its leading cause and the fault fits better
  than normal. Separate thresholds are essential: healthy rooms whose best fault
  is a draft show at most 6–17% excess, while ordinary ±12% house variation
  looks like a 21–44% envelope excess. One shared threshold detected no drafts.
- **Persistence and cause.** A room is flagged after `persistence_nights`
  consecutive candidate nights with the same leading cause. The cause is named
  only when the draft/envelope BIC gap exceeds `cause_gap_bic`.

**Tuned settings** (`backend/diagnosis/monitoring_settings.json`): draft
`a = 0.05, b = 0.05`; envelope `a = 0.20, b = 0.30`; persistence 2 nights;
cause gap 10 BIC. The file fingerprints the engine assets it was tuned against
and is rejected when they change.

**How it was tuned (TRAINING winter 2019-20 only).**
`python -m backend.simulation.monitoring_study --houses 6 --nights 14` simulates
192 houses (healthy; draft and envelope faults ×1.6/×2.2/×3 in every room) over
14 consecutive real-weather nights from random start dates, and saves every
fit (about 10 minutes; raw output is not committed).
`python -m backend.simulation.tune_monitoring` grid-searches the six settings on
even-numbered houses with two constraints: no healthy house flagged and at most
two wrong confident answers. (One was infeasible: the best settings call two
severe drafts envelope losses, in the right room.) Odd-numbered houses are
scored once and never tuned on. A test replays the cached fits and checks that
the live rule makes identical decisions.

| Check houses (never tuned on) | Correct room + cause | Median night | Worst night |
|---|---|---|---|
| Draft ×1.6 | 8/12 | 4.5 | 12 |
| Draft ×2.2 | 12/12 | 3 | 5 |
| Draft ×3 | 10/12 | 3 | 6 |
| Envelope ×1.6 | 11/12 | 3 | 4 |
| Envelope ×2.2, ×3 | 24/24 | 2 | 2 |
| Healthy houses flagged | 1/24 | | |
| Confident but wrong | 2/72 | | |

Full numbers are in `reports/monitoring/flag_rule_tuning.json`. These are
TRAINING-season simulated results, not held-out or real-home accuracy. The
held-out winter 2020-21 is reserved for the final benchmark. Caveat: the public
template's calibration used the legacy night 2020-12-06, which lies in that
winter, so the benchmark must exclude that night or the template must first be
recalibrated on winter 2019-20 nights only.

### Fan test (2026-10-25)

When a flagged room's cause is unclear, a demo house can run its next night as
a **fan test**: a 2-hour extract fan (the simulator's 50 cfm, 23:00–01:00, doors
closed). The fan pulls outside air through the leakage paths, so a leaky room
cools noticeably faster while it runs and a room with weak walls does not.

**Rule (`backend/app/monitoring_service.py`).** A fan night never decides
whether a room is flagged: status, alarm level and streak come from ordinary
nights only. For a flagged room, the fan nights inside its fit window join its
ordinary nights in a second fit, and only that fit's leading cause and BIC gap
are used to name the cause (same `cause_gap_bic`). Extra heat loss, money and
the fits shown stay those of the ordinary nights.

**Evidence (TRAINING winter 2019-20, 24 fault cases × 8 houses per setting).**
After K ordinary nights, one more ordinary night was compared with one fan
night, in the same houses and weather:

| K | Unclear rooms | +1 ordinary night names right | +1 fan night names right | Named wrong |
|---|---|---|---|---|
| 2 | 46 | 21 | 39 | 0 |
| 3 | 28 | 11 | 26 | 0 |
| 4 | 24 | 9 | 19 | 0 |

Over all faults the fan night also cut confident wrong names (2–3 versus 4–5).
Letting the fan night count toward *flagging* would have raised false alarms:
healthy neighbour rooms crossed the alarm in 18–38 of 224 cases, versus 5–7 with
an ordinary night, because the fan cools every room. Hence the cause-only rule.
On the held-out demo path, 15 of 16 unclear rooms were named correctly after a
fan test, none wrongly, and no room changed status because of it. Simulated
results only, not real-home accuracy; in a real home the occupant runs the fan
(not with an open-flued appliance) and uploads that night.

### House shapes (2026-10-25)

Demo houses can run on the HH09 twin or on single-storey plans: four presets in
`shared/homes/presets/` and plans users save. `backend/simulation/plan_house.py`
builds the truth house with the twin's per-geometry ASSUMPTIONs (fabric loss per
exposed m2 transferred from the twin); the engine template and flag rule are
transferred exactly as for real homes. Held-out demo check (each sensed room,
leak and weak insulation x2.2, 2 houses, 7 nights): HH09 14/16 found, compact
cottage 10/12, L-shaped 17/20, ranch 18/20, open-plan 14/16; 1-2 named wrong per
shape, all leaks read as insulation, as on HH09. Simulated results only.

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
- **Result (with windows and air-to-air coupling):** per-house RMSE is
  0.161 °C (noise is 0.15) and all 40 houses converged. The air-fabric
  coefficient is 17.5 W/m²K (IQR 16.9–18.0). The four-room total at
  season-mean wind is 140 W/K, against HH09's measured 172 W/K for the whole
  dwelling including the bathroom; that is a reference check only.
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
