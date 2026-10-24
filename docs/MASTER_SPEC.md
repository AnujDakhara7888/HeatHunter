# HeatHunter master specification

This file stores the team's binding product specification. It has two parts:

1. **Part A — HH09 architecture update.** This is the latest decision. Where it
   conflicts with Part B, Part A wins. For example, Part A replaces the NOAA Long
   Island weather and the generic four-room house.
2. **Part B — Frozen v3 master development prompt.** This is the original full
   specification, copied verbatim.

Repository-specific rules are in `AGENTS.md`, `docs/CONTRACTS.md`, and
`docs/HH09_TWIN_INPUTS.md`.

---

# Part A — Final architecture update (HH09)

**HeatHunter — Final architecture update for everyone**

We are keeping the frozen v3 product and all existing work. We are making ONE architectural change to make the project scientifically and visually consistent.

**NEW DESIGN:**
Both the Real Homes tab and the Fault Lab will be based on SMETER house HH09 in England.

- **Real Homes:** Actual HH09 room temperatures, original floor plan, documented characteristics, and matching local SMETER weather.
- **Fault Lab:** An APPROXIMATE HH09-inspired digital twin. Use documented room geometry/relationships where available, explicitly assumed thermal parameters where unavailable, and actual HH09-region weather as simulation inputs.
- We inject synthetic hidden faults into the approximate twin, generate synthetic room temperatures, diagnose the faults, run the simulated test, and verify repairs.

The digital twin is NOT an exact replica of the real house. We are NOT claiming HH09 has a confirmed draft or insulation defect.

**Rules:**
1. Do not restart the repo or delete existing work.
2. Keep the existing Pydantic contracts and API endpoints unless a strictly necessary change is agreed by Nikhil.
3. Stop using NOAA Long Island weather for new Fault Lab scenarios. Keep previously acquired data as archived resources if useful; do not delete it unnecessarily.
4. Use actual HH09 weather from the SMETER dataset for corresponding real observations, and weather from the same documented geographic source/region for simulated scenarios.
5. Do not use real HH09 indoor temperatures as synthetic observations.
6. Keep the simulator's hidden fault parameters inaccessible to the diagnosis engine.
7. Do not calibrate and evaluate on the same held-out observations.
8. Preserve the existing diagnostic experiment, repair calculation, evaluation, and two-tab UI.
9. No other developer should modify another person's modules.
10. Each person follows the individual instructions below and reports their interfaces and commits.

**Product story:**
"We use measurements and documented characteristics from a real SMETER house to inform an approximate digital twin. We inject controlled faults into the twin to test whether HeatHunter can identify them, recommend further evidence, and evaluate repairs."

Anuj owns data/twin inputs, Kailash owns the public physics model, Mihir owns the hidden-fault simulator and diagnosis, and Nikhil owns API/UI integration.

Please implement this update on your own branch without replacing the project's current implementation.

---

# Part B — Frozen v3 master development prompt (verbatim)

# HEATHUNTER
## FINAL MASTER DEVELOPMENT PROMPT — FROZEN v3
### Full product specification, scientific design, architecture, interface contracts, development process and individual agent assignments

---

# SECTION 0 — WHO YOU ARE AND HOW YOU MUST OPERATE

You are an expert software engineering agent contributing to **HeatHunter**, a four-person master's-student hackathon project for SBUHacks.

You will receive this same specification in four separate Claude Code sessions. Each session belongs to one team member.

**TEAM_MEMBER = "ENTER YOUR NAME HERE"**

Valid names:

- Anuj
- Kailash
- Mihir
- Nikhil

The human must replace `ENTER YOUR NAME HERE` with exactly one of these names.

If the name is absent or invalid, ask only for the name.

If the name is valid, DO NOT ask for further generic clarification. Inspect the repository and begin implementation of that person's assigned work.

## Your primary instructions

1. Understand the entire product and its architecture before writing code.
2. Work **only on the files and modules assigned to TEAM_MEMBER**.
3. Respect the shared contracts and scientific rules.
4. Do not implement other members' modules, even if they are not finished.
5. Use small, clearly labeled synthetic fixtures to unblock work when another module is not ready.
6. If an integration requires a change outside your ownership, propose the exact interface change and leave implementation to its owner.
7. Do not overwrite or delete anyone else's work.
8. Work on your own Git branch or worktree.
9. Write working code and tests, not merely pseudocode or a development plan.
10. Run the relevant code and tests before reporting that a feature works.
11. If a task is blocked, report the precise blocker and continue with independent work.
12. Do not fabricate measurements, scientific results, benchmark scores, prices or source data.
13. Do not begin optional features until your assigned core deliverables work.
14. Do not expand the frozen product scope without explicit human instruction.
15. Continue autonomously through your assigned milestones rather than stopping after each small file.

**You are one contributor to a single shared product. You are not the engineering agent for the entire team.**

---

# SECTION 1 — WHAT EXACTLY ARE WE BUILDING?

## Product name

**HeatHunter**

## Product concept

HeatHunter is a physics-guided home thermal diagnostic platform.

It behaves like a **check-engine light for a house**.

A homeowner places inexpensive temperature sensors in rooms, records temperatures during a cold night, and supplies outdoor weather information.

HeatHunter tries to determine:

1. Is a room cooling unusually fast?
2. Is that behavior consistent with an air leak, excessive conductive heat loss, or normal behavior?
3. Is the evidence sufficient to distinguish those explanations?
4. Would an additional measurement or experiment help?
5. What could an appropriate repair improve?
6. Did a simulated repair actually resolve the abnormal behavior?

Instead of merely plotting sensor readings, the system uses thermal physics to investigate competing causes.

## Product pitch

"HeatHunter is a check-engine light for your home. It detects unusual room-level heat loss, investigates whether a draft or poor insulation could be responsible, recommends a useful diagnostic test when the evidence is ambiguous, and estimates and verifies the impact of repairs."

## Important positioning

This is a preliminary diagnostic concept, not a certified building energy audit.

We are demonstrating the complete scientific workflow with a controlled simulator and providing a separate real-house data reference.

We must not imply that the simulated diagnosis accuracy is proven for real occupied homes.

---

# SECTION 2 — PRODUCT SCOPE: DO NOT EXPAND

The product has **two tabs**, not an entire website full of separate pages.

## TAB 1 — FAULT LAB

This is the main interactive product and the centerpiece of the hackathon demonstration.

It uses a virtual four-room house.

The user can:

1. Choose a guided scenario or Judge Mode.
2. See a house with room temperatures.
3. Run a physics-based heat-loss investigation.
4. See which room is abnormal.
5. See ranked explanations.
6. See an honest ambiguous or unexplained result when appropriate.
7. Learn whether an additional simulated test would help.
8. Run the test if recommended.
9. See the diagnosis update.
10. Review estimated waste, repair cost and payback.
11. Apply the diagnosed repair.
12. See new simulated observations after repair.
13. Compare the original and repaired behavior.
14. Reveal the actual hidden fault.

## TAB 2 — REAL HOMES

This is a supporting scientific credibility panel.

It uses a real building from the SMETER Phase 2 dataset.

Display:

- Original floor-plan image.
- Real room temperature measurements.
- Matching historical outdoor weather.
- Available documented building characteristics.
- Professionally measured whole-building heat-transfer coefficient, if available for the selected home.
- Available airtightness measurement.
- Data attribution.
- Explicit real-measurement labels.

The Real Homes tab does not prove HeatHunter can correctly identify real room-level defects.

That distinction must be preserved.

## Explicitly excluded from core scope

DO NOT build:

- User accounts.
- Authentication.
- Payments.
- Cloud databases.
- Live IoT ingestion.
- Thermal camera hardware.
- Complex 3D rendering.
- Three.js.
- Separate wall-versus-window diagnosis.
- A large machine-learning training pipeline.
- Chatbot functionality.
- Multiple real homes.
- Real-home room-level fault identification.
- A complex dashboard of forecasting baselines.
- Production-scale deployment infrastructure.

## Core fault categories

Exactly:

- `draft`
- `envelope_conduction`
- `none`

Optional later:

- `weak_heating`

Do not implement `weak_heating` until the primary diagnosis loop works and the team explicitly enables stretch scope.

---

# SECTION 3 — THE USER JOURNEY

The primary demo should look and behave as follows.

## STEP 1 — Start investigation

The user opens Fault Lab.

They see:

- A beautiful four-room house diagram.
- A "Guided Demo" button.
- A "Judge Mode" button.
- A "Surprise Me" option.

The house initially displays neutral room colors.

## STEP 2 — Collect temperature evidence

The scenario loads one night of simulated indoor temperature observations driven by real historical Long Island outdoor weather.

The simulated house has a hidden fault.

Display:

- Temperature curves for all four rooms.
- Outdoor temperature.
- Wind speed.
- Nighttime test protocol.
- Heating-off status.

Every data series has provenance.

## STEP 3 — Diagnose heat loss

The user clicks "Analyze House".

The backend evaluates thermal behavior.

One room may become highlighted amber/red.

The diagnosis panel states:

- Which room is suspicious.
- Which hypotheses best explain the data.
- Whether the result is confident, ambiguous or unexplained.
- Which measurements support or contradict the explanations.

## STEP 4 — Decide whether another test is valuable

When the two leading explanations cannot be distinguished, HeatHunter predicts how those explanations would respond to a controlled simulated exhaust-fan depressurization test.

If the predicted difference is meaningfully observable, recommend the test.

If the test would not distinguish the causes, say so.

Do not always recommend the experiment.

## STEP 5 — Run experiment

The user clicks "Run Recommended Test".

The simulator generates a new set of temperature measurements under the test protocol.

The diagnosis engine refits the hypotheses using the additional data.

The UI displays:

- Before-test diagnosis.
- New test observations.
- Updated diagnosis.
- Explanation of why the result changed.

## STEP 6 — Show financial implications

For a supported heat-loss diagnosis:

Display:

- Estimated additional heat-transfer coefficient.
- Estimated energy lost.
- Assumed energy tariff.
- Assumed heating efficiency.
- Illustrative annual cost.
- Assumed repair cost.
- Simple payback.

All estimates must be transparently labeled and tied to configurable assumptions.

## STEP 7 — Apply repair and verify

The user clicks "Apply Fix".

The system applies the **diagnosed repair**, not the secretly correct repair.

The truth simulator runs again with the corresponding physical parameter changed.

Use the same:

- Weather.
- Random seed.
- Initial conditions.
- Occupancy assumptions.
- Simulation duration.

The system produces new simulated measurements.

The diagnosis engine analyzes the repaired measurements.

Display before and after curves and the measured-in-simulation improvement.

If the diagnosis is wrong, the repair may not improve the underlying problem much. The interface must show that honestly.

## STEP 8 — Reveal actual cause

Only after investigation, users may click "Reveal Answer".

Display:

- Actual simulated fault.
- Actual affected room.
- Actual fault severity.
- Whether the diagnosis matched.
- Whether the repair addressed the cause.

**Never expose the hidden answer to the diagnostic engine before the reveal.**

---

# SECTION 4 — THE TWO PHYSICS MODELS

This distinction is essential.

The simulation engine and diagnosis engine must use different levels of physical detail.

This reduces the risk of unrealistically high performance from testing a model only against itself.

## 4.1 TRUTH SIMULATOR

Owner: **Mihir**

The simulator generates the actual synthetic measurements.

It models four rooms:

- Living Room
- Kitchen
- Bedroom 1
- Bedroom 2

Each room has two thermal states:

- Indoor air temperature.
- Effective wall/thermal-mass temperature.

For room i:

C_air,i × dT_air,i/dt =
− H_window,i × (T_air,i − T_out)
− H_infiltration,i(t) × (T_air,i − T_out)
− H_air_mass,i × (T_air,i − T_mass,i)
+ Σ H_interroom,ij × (T_air,j − T_air,i)

C_mass,i × dT_mass,i/dt =
H_air_mass,i × (T_air,i − T_mass,i)
− H_wall,i × (T_mass,i − T_out)

Use physically consistent units:

- Temperature: °C.
- Heat flow: watts.
- Thermal capacity: J/K.
- Conductance: W/K.
- Time: seconds.

For the core nighttime experiment, heating is off during measurement.

The virtual house begins warm enough for measurable cooling.

## Infiltration model

Use a weather-sensitive infiltration approximation:

ACH_i = L_i × sqrt(c_stack × |T_air,i − T_out| + c_wind × wind_speed²)

H_infiltration,i = 0.33 × ACH_i × room_volume_m3

The factor 0.33 has the appropriate approximate units for sensible-air heat transfer when ACH is in exchanges per hour and volume is in m³.

The coefficients must be selected and documented.

The equation is a simplified empirical assumption, not a full airflow model.

## Sensor model

Sample every five minutes.

Add realistic measurement effects:

- Approximate random measurement noise.
- Small sensor-specific offsets.
- Temperature rounding.
- Occasional missing readings.

Use deterministic random seeds.

Ensure sensor offsets are distinguishable from genuine thermal anomalies where feasible.

## Fault injection

### Draft fault

Increase the affected room's infiltration/leakage parameter.

### Envelope conduction fault

Increase its effective wall/envelope conductance.

### Healthy case

Do not inject a fault.

Support multiple fault severities and multiple room locations.

Do not build separate window and wall diagnoses in the core MVP.

## House variation

Randomly vary nominal thermal properties within bounded ranges across simulated healthy houses.

Include variations in:

- Thermal mass.
- Conductance.
- Inter-room coupling.
- Leakage.
- Sensor offsets.
- Initial mass temperatures.

Variation must be controlled by training/held-out seeds.

## Simulation solver

Use SciPy `solve_ivp` or a stable, well-tested fixed-step integrator.

Add tests verifying:

- Rooms cool when outdoors is colder and heating is off.
- Heat flows toward equilibrium.
- No spontaneous energy creation.
- Changing the fault parameter changes thermal response.
- Identical seeds and inputs reproduce identical results.

---

# SECTION 5 — THE PUBLIC DIAGNOSTIC MODEL

Owner: **Kailash**

Use a simplified single-node per-room RC model.

For each room:

C_i × dT_i/dt =
− [m_c × H_cond,i + H_infiltration,i(t)] × (T_i − T_out)
+ Σ H_ij × (T_neighbor,measured − T_i)

Approximate infiltration:

H_infiltration,i(t) =
m_l × H_inf0,i × (1 + beta_i × wind_speed)
+ fan_on(t) × 0.33 × fan_flow_m3_per_h × leakage_share_i

The hypothesis-dependent leakage share for a candidate fault in room i is:

leakage_share_i =
(m_l × nominal_leak_share_i)
/
[sum_of_nominal_leak_shares + (m_l − 1) × nominal_leak_share_i]

Use nominal template parameters learned or calibrated exclusively from healthy training scenarios.

The diagnostic model must not read the truth simulator's actual parameters.

## Hypotheses

### Normal

All multipliers fixed at 1.

### Draft

Fit infiltration multiplier `m_l`.

### Envelope conduction

Fit envelope conductance multiplier `m_c`.

Allow physically sensible parameter bounds.

Use SciPy nonlinear least squares.

The fitted model must be evaluated against recorded observations.

## Important limitations

Passive cooling curves can constrain H/C without uniquely identifying H or C.

Different physical causes can produce similar trajectories.

Uncertain thermal mass and sensor offsets can distort inference.

The system should report insufficient evidence where the measurements do not distinguish hypotheses.

## Fitting requirements

- Accept one or more nights.
- Support passive observations.
- Support additional experiment observations.
- Preserve original observation timestamps.
- Skip or account for early thermal transients.
- Handle missing sensor measurements.
- Return parameter estimates and residual metrics.
- Return comparable likelihood/BIC scores.
- Avoid leakage from held-out scenarios into nominal calibration.

## Calibration

Build:

`calibrate_public_template(healthy_training_nights)`

Save the resulting public template for use on held-out scenarios.

Never recalibrate nominal parameters using a held-out fault's ground-truth values.

The template can include:

- Room volumes.
- Nominal capacitances.
- Envelope conductance.
- Infiltration coefficients.
- Wind sensitivity.
- Inter-room coupling.
- Leakage shares.

---

# SECTION 6 — DIAGNOSTIC DECISION ENGINE

Owner: **Mihir**

The diagnostic logic consumes Kailash's public model and fit results.

It must NOT import the truth store.

## Stage 1 — Evaluate room hypotheses

For each room, fit:

- Normal.
- Draft.
- Envelope conduction.

Compute model error and BIC.

## Stage 2 — Detect possible abnormal room

Use:

anomaly_score =
BIC_normal − BIC_best_fault

A large positive result suggests a fault hypothesis explains the measurements better than the normal model.

Choose the most anomalous room if the score exceeds a threshold calibrated on training data.

Otherwise return:

`no_fault`

## Stage 3 — Check model adequacy

A lowest-BIC model can still fit poorly.

Evaluate residual error against a calibrated adequacy threshold.

If no available model adequately explains the data, return:

`unexplained`

Suggested explanation:

"None of our available models adequately explains these measurements. More evidence is needed."

## Stage 4 — Rank explanations

Rank candidate hypotheses using comparable BIC scores.

If two leading explanations are close:

`ambiguous`

If one is clearly better and fit is adequate:

`confident`

Do not convert raw BIC differences into fake probability percentages.

## Stage 5 — Decide whether an additional experiment helps

When the diagnosis is ambiguous, evaluate the available experiment.

Do not automatically recommend it.

Predict temperature trajectories under the competing fitted hypotheses.

Calculate:

separation_score =
RMS(prediction_A − prediction_B) / expected_measurement_noise

If predicted separation exceeds a calibrated practical threshold, recommend the test.

Otherwise state that the available test is unlikely to distinguish the causes.

Model uncertainty, systematic bias, and sensor offsets should be acknowledged; the basic noise-normalized separation score is only a heuristic.

## Stage 6 — Update diagnosis

After additional observations:

1. Fit all hypotheses again.
2. Recalculate anomaly scores.
3. Re-evaluate model adequacy.
4. Re-rank causes.
5. Update status.
6. Return explanation and results.

No hardcoded "after the fan test, the diagnosis becomes draft."

It must come from actual model fitting.

---

# SECTION 7 — ACTIVE DIAGNOSTIC EXPERIMENT

Core experiment:

`E1_exhaust_fan`

Owner of physical simulation: **Mihir**

Owner of predicted public-model response: **Kailash**

## Purpose

Investigate whether additional thermal loss is more consistent with infiltration rather than envelope conduction.

## Simplified simulation assumption

The exhaust fan extracts air from the house.

Replacement air enters through leakage paths.

For the synthetic model, assume make-up airflow is distributed proportionally to room leakage coefficients.

Additional room infiltration heat transfer is approximately:

Delta_H_i =
0.33 × fan_flow_m3_per_h × leakage_share_i

Use the same documented leakage-share convention consistently in the truth and public models, while preserving the differences between their other physical assumptions.

This is a controlled simulation model, not a validated real-home pressure-network prediction.

## Critical distinction

A normal household exhaust fan is not a professional blower-door apparatus.

Real pressure-driven infiltration depends on room connectivity, openings, pressure differences, flues and other conditions.

Do not present this test as proven to identify leaks in occupied homes.

## Safety warning in UI

"Depressurization can backdraft some natural-draft combustion appliances. This demonstration is simulated; real-world testing requires appropriate safety assessment."

## Experimental protocol

- Heating off.
- Doors modeled as closed.
- Defined fan airflow.
- Defined fan run period.
- Real historical outdoor weather used as simulator input.
- Simulated observations recorded with the normal sensor-noise process.

If the method does not distinguish draft from conduction with realistic fan flows and noise, the team must use the documented fallback rather than forcing a positive result.

## Fallback

Use the contrast between calm and windy nights.

Analyze whether temperature response changes with wind in a way consistent with an infiltration hypothesis.

Do not pretend wind is definitive proof of leakage.

---

# SECTION 8 — REPAIR AND COST ENGINE

Owners:

- Kailash: financial model and fitted benefit calculations.
- Mihir: physical repair simulation and new observations.

## Available repairs

For `draft`:

`seal_leaks`

Reduce the affected room's infiltration/leakage parameter toward its healthy value.

For `envelope_conduction`:

`add_insulation`

Reduce the affected room's elevated envelope conductance toward its healthy value.

A user-selectable effectiveness control determines how much the faulty parameter is restored.

## Important rule

Apply the repair indicated by the **diagnosis**, not the hidden truth.

If the diagnosis is incorrect, the repair may have little effect.

Do not fabricate repair success.

## Financial calculation

For an envelope heat-loss hypothesis:

Delta_H_effective =
(fitted_multiplier − 1) × nominal_path_conductance

Approximate seasonal heating energy:

annual_heat_loss_kwh =
Delta_H_effective × heating_degree_days × 24 / 1000

Then:

fuel_energy_kwh =
annual_heat_loss_kwh / assumed_heating_efficiency

estimated_annual_cost =
fuel_energy_kwh × assumed_energy_price

simple_payback_years =
repair_cost / estimated_annual_savings

Clarify fuel/heat-pump efficiency conventions and convert energy-price units consistently.

These are screening estimates based on explicit assumptions.

## Sources

Store sourced default assumptions in:

`config/assumptions.json`

Examples:

- Heating degree days.
- Heating energy tariff.
- Heating-system efficiency.
- Typical fan airflow.
- Approximate repair costs.

Prefer authoritative sources such as NOAA, EIA, DOE and ENERGY STAR.

If a number cannot be reliably sourced, make it user-configurable without presenting it as a verified default.

## Repair verification

1. Run original faulty scenario.
2. Apply diagnosed repair.
3. Rerun the truth simulator with identical external forcing and initial conditions.
4. Generate new simulated sensor readings.
5. Refit the diagnostic model.
6. Compare before/after estimated thermal behavior.
7. Show estimated benefit and simulated re-measured result separately.

If the modeled annual savings estimate is unjustified, show only scenario-specific thermal differences.

---

# SECTION 9 — REAL DATA PANEL

Owner: **Anuj**

Dataset:

SMETER TEST Phase 2.

Official source:

https://reshare.ukdataservice.ac.uk/856978/

DOI:

https://doi.org/10.5255/UKDA-SN-856978

This dataset includes documented household thermal measurements and building information.

## Task

Download and inspect the official data and documentation.

Do not guess filenames or column names.

Select one suitable house.

Extract:

- Original floor-plan image.
- Indoor temperatures.
- Matching outdoor weather.
- Relevant building description.
- Documented reference whole-building HTC.
- Airtightness, where present.

Normalize timestamps and units.

Prepare a compact frontend-friendly JSON object.

## Critical scientific restriction

The SMETER house does not contain verified room-level fault labels.

Do not claim the real house's coldest room has defective insulation or an air leak.

The Real Homes tab demonstrates how real building data appears and how it could feed future analysis.

It does not validate synthetic root-cause classification.

## Optional HTC comparison

If the main Fault Lab is complete:

Use a time-boxed energy-signature estimator to compare a whole-building HTC estimate with an independently measured reference.

State limitations from:

- Domestic hot water.
- Boiler efficiency.
- Internal gains.
- Solar gains.
- Heating intermittency.

Report actual numerical error if computed.

Do not invent a convincing result.

---

# SECTION 10 — THE WEB APPLICATION DESIGN

Owner: **Nikhil**

## Frontend stack

- Vite.
- React.
- TypeScript.
- Tailwind CSS.
- Recharts.
- SVG.

## Visual character

Make HeatHunter feel like a premium environmental engineering tool.

A strong UI is essential, but the UI must serve the scientific workflow.

### Color palette

Suggested:

- Background: deep navy / near-black.
- Panel surfaces: dark slate.
- Primary accent: cyan or electric blue.
- Cool temperatures: blue.
- Abnormal thermal loss: amber to red.
- Successful improvement: muted green.
- Secondary text: cool gray.

### Typography

Use a modern sans-serif system.

Emphasize:

- Large readable temperature values.
- Clear headings.
- Small subdued provenance labels.
- Accessible chart labels.
- Concise plain-English interpretation.

Avoid overly decorative UI.

## Layout

Desktop:

- Full-width navigation header.
- Main interactive house visualization.
- Temperature/time-series charts.
- Evidence and diagnosis panel.
- Next-test panel.
- Repair and cost section.

Mobile:

Stack these sections vertically.

## Main Fault Lab UI components

### 1. Header

- HeatHunter branding.
- Fault Lab tab.
- Real Homes tab.
- Current mode indicator.

### 2. Scenario controls

- Guided Demo.
- Judge Mode.
- Surprise Me.
- Reset.

### 3. Interactive house

Use a four-room SVG diagram.

Rooms must be:

- Clickable.
- Clearly labeled.
- Visually associated with temperature measurements.
- Highlighted when selected.
- Highlighted for detected abnormalities.

### 4. Temperature timeline

Use Recharts.

Plot:

- Selected room.
- Other rooms.
- Outdoor temperature.
- Fan activity when an experiment is run.

Allow room selection.

Use clear legends and units.

### 5. Diagnosis panel

Display:

- Affected room.
- Diagnosis status.
- Ranked candidate causes.
- Supporting evidence.
- Limitations.

Possible states:

- `no_fault`
- `ambiguous`
- `confident`
- `unexplained`

Use plain language, not only technical metrics.

### 6. Recommended test card

When applicable:

- Experiment name.
- Why it helps.
- Predicted discrimination score.
- Safety note.
- Run Experiment action.

When no experiment is useful:

Display a meaningful explanation.

### 7. Cost section

Display:

- Estimated annual energy waste.
- Illustrative annual cost.
- Repair cost.
- Payback.
- Assumptions.
- Adjustable tariff.
- Adjustable repair price.

No hardcoded fake results.

### 8. Repair verification

Show:

- Original temperature curve.
- Repaired temperature curve.
- Predicted improvement.
- Re-measured-in-simulation improvement.
- Whether abnormal behavior improved.

### 9. Ground truth reveal

Reveal hidden fault only when the user explicitly asks.

Never place actual hidden parameters in normal diagnosis API payloads.

### 10. Scientific evidence drawer

A collapsible area for:

- Synthetic benchmark summary.
- Model assumptions.
- Data provenance.
- Limitations.
- Links to sources.

## Real Homes tab

A simpler panel showing:

- Actual house plan image.
- Room temperature plots.
- Weather.
- Documented HTC/airtightness.
- Source details.
- Honest notes.

## Non-negotiable UI behavior

- Every visible button works.
- No fake metrics.
- Loading states.
- Error states.
- Empty states.
- No simulated result labeled real.
- No hidden fault exposed accidentally.
- No invented real fault diagnosis.

---

# SECTION 11 — TECHNICAL ARCHITECTURE

Use one monorepo.

## Backend

Python 3.11 or newer.

Libraries:

- FastAPI.
- Pydantic v2.
- NumPy.
- SciPy.
- Pandas.
- Pytest.

Optional:

- PyArrow.
- Matplotlib.

## Frontend

- Vite.
- React.
- TypeScript.
- Tailwind.
- Recharts.

## Storage

For hackathon reliability:

- JSON files.
- Parquet files.
- In-memory scenario store.

No database is required.

## Type generation

Use Pydantic models as the API source of truth.

Generate TypeScript types from FastAPI OpenAPI using `openapi-typescript`.

Do not manually maintain inconsistent duplicate TypeScript API interfaces.

## Offline functionality

The application must work without live network requests during the demo.

Download and cache:

- Historical weather.
- Selected SMETER house data.
- Public model template.
- Benchmark summary.
- Guided demo scenario seeds.

External data retrieval occurs during development, not during judge interaction.

---

# SECTION 12 — REPOSITORY STRUCTURE

```text
heat-hunter/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── .gitignore
├── .env.example
│
├── docs/
│   ├── CONTRACTS.md
│   ├── PHYSICS.md
│   ├── SMETER_INVENTORY.md
│   ├── EVALUATION.md
│   └── DEMO.md
│
├── config/
│   └── assumptions.json
│
├── shared/
│   └── fixtures/
│
├── data/
│   ├── raw/
│   ├── processed/
│   └── weather/
│
├── scripts/
│   └── poc_loop.py
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── contracts.py
│   │   └── routes/
│   ├── data_pipeline/
│   ├── engine/
│   ├── simulation/
│   ├── diagnosis/
│   ├── evaluation/
│   └── tests/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── styles/
│   └── public/
│
└── reports/
    └── evaluation/
```

Each person owns the code related to their responsibility.

---

# SECTION 13 — API CONTRACTS

Nikhil is the integration owner and maintains Pydantic request/response models.

Other members must implement compatible service functions.

## API routes

GET `/api/health`

Returns backend health.

POST `/api/scenarios`

Creates guided, judge-selected or random hidden scenario.

GET `/api/scenarios/{id}/observations`

Returns observed nights, weather and protocol.

POST `/api/scenarios/{id}/diagnose`

Returns diagnostic results.

POST `/api/scenarios/{id}/experiments`

Runs supported diagnostic experiment and returns observations and updated diagnosis.

POST `/api/scenarios/{id}/repair`

Applies the diagnosed repair and returns comparison.

GET `/api/scenarios/{id}/reveal`

Returns hidden ground truth.

GET `/api/real/house`

Returns selected real SMETER house information.

GET `/api/evaluation/summary`

Returns precomputed benchmark results.

## Shared conventions

- UTC ISO timestamps.
- °C for temperature.
- W for power.
- W/K for heat-transfer coefficients.
- J/K for capacitance.
- kWh for energy.
- m³ for volume.
- m/s for wind.
- m³/h for fan airflow.
- USD for monetary values.
- `null` for missing values.
- `snake_case` for field names and IDs.

## Required schemas

### Series

```json
{
  "timestamps": [],
  "values": [],
  "unit": "degC",
  "provenance": "SIMULATED_MEASUREMENT"
}
```

### WeatherNight

- night_id
- source
- location
- outdoor_temperature
- wind_speed
- train_or_heldout_split

### PublicTemplate

- room identifiers
- room names
- volumes
- nominal capacitances
- envelope conductances
- infiltration parameters
- wind sensitivities
- nominal leakage shares
- inter-room couplings

### Protocol

- heating_off
- doors_closed
- fan_on
- fan_airflow
- fan_start
- fan_end

### NightObservations

- night_id
- kind
- room_temperature_series
- weather
- protocol

### HypothesisFit

- fault_type
- fitted_multiplier
- SSE
- BIC
- residual_RMSE

### Diagnosis

- status
- flagged_room_id
- ranked_causes
- evidence
- uncertainty
- test_decision
- money_estimate
- assumptions

### MoneyEstimate

- excess_conductance
- annual_energy_estimate
- annual_cost_estimate
- repair_cost
- payback
- assumptions

### RepairResult

- repair_type
- effectiveness
- original_observations
- repaired_observations
- diagnosed_improvement
- estimated_savings
- remeasured_savings

### GroundTruth

- fault_type
- actual_room_id
- severity

Do not expose GroundTruth until the reveal endpoint.

The finalized precise definitions belong in `backend/app/contracts.py`.

---

# SECTION 14 — SCIENTIFIC PROVENANCE AND DATA SAFETY

Allowed provenance values:

- REAL_MEASUREMENT
- SIMULATED_MEASUREMENT
- SIMULATED_GROUND_TRUTH
- MODEL_ESTIMATE
- ASSUMPTION

Every important series and result must be traceable to its source.

Do not use one numerical label to imply another source category.

## Hidden fault isolation

The diagnostic engine may receive:

- Public house template.
- Observed room temperatures.
- Weather.
- Known protocol.
- Public fan airflow assumptions.

It may NOT receive:

- Actual hidden fault label.
- Hidden fault severity.
- True underlying room leakage coefficients.
- Secret simulator thermal parameters.
- Direct references to the private truth store.

Write tests to enforce this architecture.

---

# SECTION 15 — PROOF OF CONCEPT BEFORE POLISH

The biggest scientific risk is whether the available experiment actually separates draft and conduction faults under realistic conditions.

Therefore:

**Mihir and Kailash must prove the core diagnostic loop before Nikhil invests time polishing it.**

Create:

`scripts/poc_loop.py`

The proof of concept should:

1. Create a healthy nominal house.
2. Inject a draft fault.
3. Generate passive-night observations.
4. Fit normal, draft and conduction hypotheses.
5. Show diagnostic rankings.
6. Repeat for a conduction fault.
7. Identify at least one scenario where the passive observations are ambiguous.
8. Compute predicted fan-experiment discrimination.
9. Run a fan experiment under reasonable assumptions.
10. Fit using the combined observations.
11. Report whether the correct cause ranks first.
12. Print all actual numerical results.

Use realistic airflow and sensor noise assumptions.

Do not force the result by selecting unrealistic fan flow or exposing fault truth.

### GO / NO-GO

If the fan experiment provides useful discrimination under reasonable conditions:

Proceed.

If it fails:

Use a calm-versus-windy observation strategy as the main diagnostic contrast.

State the limitation.

Do not fabricate a successful experiment.

---

# SECTION 16 — EVALUATION

Owner: **Anuj**, in coordination with Mihir.

## Dataset strategy

Generate training and held-out synthetic scenarios.

Use separate:

- Random seeds.
- Weather nights.
- House-parameter samples.

## Include

- Healthy houses.
- Draft faults.
- Conduction faults.
- Multiple severities.
- Different affected rooms.
- Calm weather.
- Windy weather.
- Sensor noise.
- Parameter uncertainty.

## Core metrics

- Fault versus healthy detection.
- Affected-room identification.
- Cause classification.
- Ambiguity rate.
- Unexplained rate.
- False-positive rate.
- Accuracy before experiment.
- Accuracy after recommended experiment.
- Accuracy under a baseline test strategy where applicable.

Run at least 60 held-out scenarios if computationally feasible.

Keep all held-out scenarios out of threshold tuning.

Generate:

`reports/evaluation/summary.json`

This file must contain actual computed results.

Display:

"Diagnosis accuracy on held-out simulated scenarios."

Never imply the benchmark is a real-home field trial.

---

# SECTION 17 — EXACT OWNERSHIP BY NAME

Every agent must obey this section.

## ANUJ — DATA ENGINEERING, REAL HOMES, EVALUATION

### You own

- `backend/data_pipeline/`
- `backend/evaluation/`
- `data/`
- Data acquisition scripts.
- `docs/SMETER_INVENTORY.md`
- `docs/EVALUATION.md`
- Devpost draft content.

### Your first objective: Weather data

The simulator needs real historical outdoor weather.

1. Find a reliable historical weather source for Stony Brook, Long Island.
2. Retrieve at least eight cold-weather nights.
3. Include calm and windy periods.
4. Save outdoor temperature and wind measurements.
5. Preserve source, date, timezone and coordinates.
6. Convert timestamps to UTC.
7. Separate training and held-out nights.
8. Save cached weather JSON files.
9. Implement `load_weather_night(...)`.
10. Implement `list_weather_nights(...)`.
11. Test that other modules can load them without network access.

If the weather source is inaccessible, produce clearly synthetic fixture weather for initial local testing while documenting the missing historical data.

### Your second objective: Real SMETER home

1. Download the SMETER Phase 2 archive.
2. Read documentation.
3. Inspect available files.
4. Document actual schemas.
5. Select a house with suitable room observations.
6. Extract its floor-plan image.
7. Extract room temperatures.
8. Extract matching weather.
9. Extract documented reference HTC.
10. Extract airtightness information.
11. Normalize data into frontend-friendly JSON.
12. Add source/provenance metadata.
13. Produce basic validation plots.
14. Expose a reader function that Nikhil can call.

Time-box this work. Do not let the real-house tab block the main simulator.

### Your third objective: Synthetic benchmark harness

1. Read Mihir's scenario service interface.
2. Generate training and held-out scenario definitions.
3. Run held-out simulations.
4. Call diagnosis functions.
5. Record predicted room, predicted cause and actual truth.
6. Compare before and after experiments.
7. Calculate false positives.
8. Calculate ambiguity and unexplained rates.
9. Generate a confusion matrix.
10. Write benchmark JSON.

Mihir owns the diagnosis logic and threshold tuning. You own evaluation execution and reporting.

### Your fourth objective: Submission support

Write an accurate Devpost technical description.

Include:

- Problem.
- Solution.
- Architecture.
- Simulation.
- Diagnostic experiments.
- Scientific limitations.
- Validation.
- Data attribution.
- Team contributions.

### Your definition of done

Other modules can use cached weather and real-house data, and the team has an independently generated evaluation report.

**Do not modify the physics model, simulator, diagnosis engine, API routes or frontend.**

---

## KAILASH — PHYSICS ENGINE, CALIBRATION, SAVINGS

### You own

- `backend/engine/`
- `config/assumptions.json`
- Engine-related sections of `docs/PHYSICS.md`

### Your first objective: Implement public model

1. Read shared data contracts.
2. Implement single-node thermal dynamics.
3. Support changing outdoor temperature.
4. Support wind.
5. Support inter-room coupling.
6. Support fan experiment inputs.
7. Use correct units.
8. Validate numerical integration.
9. Write physics unit tests.

Required service:

`simulate_public(template, night_inputs, multipliers)`

### Your second objective: Fit hypotheses

Implement:

`fit_hypothesis(nights, room_id, template, cause)`

Supported causes:

- normal
- draft
- envelope_conduction

Return:

- fitted multiplier
- sum squared error
- BIC
- residual RMSE
- fitting warnings

Use SciPy optimization with bounded parameters.

Check against known generated public-model fixtures.

### Your third objective: Support experiment prediction

Implement:

`predict_experiment(template, hypothesis_fits, weather_night, protocol)`

This should produce competing predicted room-temperature trajectories for experiment selection.

Mihir will call this method.

### Your fourth objective: Public template calibration

Implement:

`calibrate_public_template(healthy_training_nights)`

Calibrate using healthy training data only.

Save resulting nominal template.

Do not read the simulator's private truth store.

### Your fifth objective: Financial model

Implement:

`estimate_money(...)`

and any consistent post-repair estimate helper.

Include:

- Excess effective conductance.
- Heating degree days.
- Heating efficiency.
- Fuel energy.
- Energy price.
- Repair cost.
- Payback.

Add documented source metadata to assumed parameters.

Return null when calculations are unsupported.

### Your sixth objective: Proof-of-concept collaboration

Coordinate with Mihir on `scripts/poc_loop.py`.

You own model fitting and predicted experiment response.

Mihir owns the truth simulation and diagnosis decision.

Do not independently implement a second diagnosis engine.

### Your seventh objective: Optional HTC

Only after the core product works, implement an experimental whole-building HTC estimator for the SMETER home.

Document every assumption and report real errors.

### Your definition of done

Given nominal public house parameters and observed temperature data, the engine fits candidate hypotheses and predicts experiment responses. Financial results are correctly calculated and documented.

**Do not modify simulation truth models, scenario stores, diagnosis orchestration, frontend or API routes.**

---

## MIHIR — TRUTH SIMULATOR, ROOT-CAUSE DIAGNOSIS, EXPERIMENTS, REPAIRS

### You own

- `backend/simulation/`
- `backend/diagnosis/`
- Simulation-related sections of `docs/PHYSICS.md`

### Your first objective: Four-room thermal simulator

1. Build the two-node-per-room model.
2. Represent all four rooms.
3. Define exterior heat-loss paths.
4. Implement internal wall/mass coupling.
5. Implement inter-room thermal coupling.
6. Implement infiltration influenced by wind.
7. Implement the heating-off night protocol.
8. Load weather from Anuj's reader when available.
9. Use labeled synthetic weather fixtures temporarily.
10. Add sensor noise and dropouts.
11. Use deterministic seeds.
12. Write physics sanity tests.

### Your second objective: Hidden faults

Implement:

- draft
- envelope_conduction
- none

Fault injection must actually modify physical parameters.

Do not encode the fault class directly in sensor data.

### Your third objective: Scenario management

Implement:

`create_scenario(mode, fault_spec=None)`

`get_observations(scenario_id)`

`reveal(scenario_id)`

Use a separate ground-truth store.

The frontend must receive only an opaque scenario ID until reveal.

### Your fourth objective: Diagnosis engine

Implement:

`diagnose(scenario_id)`

Call Kailash's public fitting services.

Perform:

- Normal vs fault fitting.
- Abnormal room selection.
- Adequacy check.
- Cause ranking.
- Ambiguity detection.
- Experiment-worthwhile decision.

Do not access hidden truth.

### Your fifth objective: Experiment

Implement:

`run_experiment(scenario_id, experiment_id)`

For E1:

- Generate new fan-test observations with the truth simulator.
- Return them as recorded synthetic data.
- Refit hypotheses.
- Update rankings and status.

Do not fake diagnosis improvement.

### Your sixth objective: Repair physics

Implement:

`apply_repair(scenario_id, effectiveness)`

The repair choice must come from the predicted diagnosis.

Reduce the corresponding faulty thermal parameter toward nominal values.

Regenerate measurements.

Compare physical behavior.

Call Kailash's functions for fitted impact and financial values.

Do not hardcode repair results.

### Your seventh objective: Training and scenario tuning

Tune diagnostic thresholds using training scenarios only.

Test multiple seeds, faults and weather conditions.

Document any scenarios where the method fails.

### Your eighth objective: Proof of concept

Work with Kailash to implement the end-to-end proof of concept.

Prioritize:

Passive ambiguity → experiment decision → extra observation → updated classification.

If the experiment does not work under plausible physics, activate the documented fallback.

### Your definition of done

A user can create an unknown simulated fault, obtain a genuine diagnosis, run the recommended experiment, apply the diagnosed repair, and later reveal ground truth.

**Do not modify SMETER ingestion, financial assumptions, API endpoints or frontend.**

---

## NIKHIL — SHARED CONTRACTS, API, FRONTEND, INTEGRATION

### You own

- `backend/app/`
- `frontend/`
- `docs/CONTRACTS.md`
- `docs/DEMO.md`
- Shared fixtures in `shared/fixtures/`

### Your first objective: Establish contracts

Before substantial independent development:

1. Inspect repository.
2. Create FastAPI application.
3. Define Pydantic schemas in `backend/app/contracts.py`.
4. Define request/response bodies for each endpoint.
5. Document API conventions in `docs/CONTRACTS.md`.
6. Create schema-valid synthetic fixtures.
7. Expose OpenAPI.
8. Configure TypeScript type generation from OpenAPI.
9. Share exact service interfaces with Anuj, Kailash and Mihir.

You are the integration owner, but do not control their internal implementations.

### Your second objective: Frontend scaffold

Create:

- React + Vite + TypeScript.
- Tailwind.
- Recharts.
- App navigation.
- Fault Lab view.
- Real Homes view.
- API client.
- Shared UI components.

### Your third objective: Main interactive house

Create a beautiful SVG house layout.

Rooms:

- Living Room.
- Kitchen.
- Bedroom 1.
- Bedroom 2.

Features:

- Room selection.
- Temperature display.
- Hover information.
- Anomaly highlighting.
- Selected-room details.

### Your fourth objective: Charts

Display:

- Simulated indoor temperatures.
- Outdoor temperature.
- Wind.
- Experiment periods.
- Before-and-after curves.

Charts must use API data, not invented static values.

### Your fifth objective: Diagnosis interface

Create:

- Cause rankings.
- Evidence.
- Ambiguous status.
- Confident status.
- No-fault status.
- Unexplained status.
- Recommended experiment card.
- Run Experiment button.
- Updated results panel.

### Your sixth objective: Financial interface

Create:

- Estimated wasted energy.
- Estimated annual cost.
- Repair-cost input.
- Energy-tariff input.
- Payback display.
- Assumptions section.

Integrate Kailash's calculations through backend services.

### Your seventh objective: Repair visualization

Create:

- Apply Repair button.
- Effectiveness slider.
- Before/after charts.
- Simulated re-measurement.
- Ground-truth Reveal button.

### Your eighth objective: API integration

Implement the nine specified endpoint operations.

Route them to each owner's service functions.

Do not rewrite teammates' algorithms inside FastAPI routes.

Use contract-valid mock responses temporarily.

Replace them when actual modules become available.

### Your ninth objective: Real Homes tab

Display Anuj's processed real data.

Use the original floor-plan image.

Label sources.

Handle unavailable fields gracefully.

### Your tenth objective: Demo reliability

1. Preselect reproducible guided scenario seeds.
2. Ensure the app works offline.
3. Test every button.
4. Make loading and error states polished.
5. Verify a clean installation.
6. Prepare a five-minute demo.
7. Record a backup video.
8. Coordinate integration and final Git merges.

### Your definition of done

The full hidden-fault investigation can be completed by clicking through a beautiful, reliable frontend with real backend outputs.

**Do not rewrite data ingestion, physics fitting, truth simulation or diagnostic algorithms.**

---

# SECTION 18 — EXACT DEVELOPMENT ORDER AND CHECKPOINTS

All four developers begin in parallel after contracts are agreed.

## GATE 1 — CONTRACTS AND SCAFFOLD

Nikhil leads.

Must exist:

- Repository.
- Shared Pydantic contracts.
- OpenAPI schema.
- TypeScript type generation.
- Basic backend startup.
- Frontend startup.
- Synthetic fixtures.
- Team ownership map.

Anuj may begin weather retrieval independently.

Kailash may begin thermal-model code against fixtures.

Mihir may begin simulator code against fixtures.

Do not wait for SMETER processing.

## GATE 2 — SCIENTIFIC PROOF OF CONCEPT

Kailash and Mihir collaborate.

Must demonstrate:

- Simulated thermal response.
- Candidate model fitting.
- At least one ambiguous case.
- Calculated experiment separation.
- New observations from the test.
- Updated diagnosis.

This checkpoint is more important than beautiful UI.

If E1 fails, use the windy-versus-calm strategy.

## GATE 3 — FIRST END-TO-END DEMO

Must support:

- Create scenario.
- Fetch observations.
- Diagnose.
- Display results.

Through the actual backend and frontend.

Do not merely show a screenshot or mock values.

## GATE 4 — COMPLETE CORE LOOP

Must support:

- Ambiguous diagnosis.
- Test decision.
- Experiment.
- Updated diagnosis.
- Money.
- Repair.
- Re-measurement.
- Ground-truth reveal.

## GATE 5 — REAL DATA AND EVALUATION

Anuj provides:

- Cached weather.
- SMETER house.
- Benchmark summary.

Nikhil integrates them.

Kailash and Mihir fix genuine scientific or technical issues identified by the benchmark.

## GATE 6 — FREEZE

Stop feature development.

Test the guided path.

Test Judge Mode.

Verify no hidden labels leak.

Verify no real/simulated mislabeling.

Record a backup video.

Prepare the final presentation and submission.

---

# SECTION 19 — GIT AND MULTI-AGENT RULES

Each member uses a unique branch.

Suggested:

Anuj:
`feature/anuj-data`

Kailash:
`feature/kailash-engine`

Mihir:
`feature/mihir-diagnosis`

Nikhil:
`feature/nikhil-frontend`

Prefer independent Git worktrees or independent clones.

Do not let all four agents edit the same checked-out repository directory simultaneously.

## Shared contracts

Nikhil owns the canonical API Pydantic models.

Anuj proposes measurement and real-house requirements.

Kailash proposes model-fitting requirements.

Mihir proposes scenario and diagnosis requirements.

Nikhil incorporates approved changes.

Frontend TypeScript types must be regenerated from OpenAPI.

## Collaboration handoffs

Anuj → Mihir:
Cached weather.

Anuj → Nikhil:
Real-house data.

Kailash → Mihir:
Hypothesis fitting and experiment predictions.

Mihir → Nikhil:
Scenario and diagnosis services.

Kailash → Nikhil:
Financial estimates.

Anuj → Nikhil:
Benchmark summary.

## Reporting after each milestone

Your report must include:

- Implemented functionality.
- Changed files.
- Tests run.
- Passing and failing tests.
- Commands for other teammates.
- Interface signatures.
- Remaining blockers.
- Next assigned milestone.

Do not claim work is complete without execution evidence.

---

# SECTION 20 — FAILURE MODES TO AVOID

### Failure: Four agents generate incompatible APIs

Prevention:
Freeze Pydantic contracts first; generate TypeScript types.

### Failure: Real data isn't ready

Prevention:
Build the simulation first using labeled fixtures.

### Failure: Fan experiment doesn't actually distinguish causes

Prevention:
Scientific proof of concept with realistic assumptions; use fallback if needed.

### Failure: Diagnosis reads hidden answers

Prevention:
Separate public inputs and private truth store, enforce dependency boundaries.

### Failure: No-fault houses are misclassified

Prevention:
Include healthy scenarios and calibrate detection thresholds.

### Failure: Every case gets a confident answer

Prevention:
Include ambiguity and adequacy checks.

### Failure: Repair always succeeds

Prevention:
Repair the diagnosed cause rather than secretly repairing ground truth.

### Failure: Fake financial precision

Prevention:
Show assumptions and approximations; avoid unsupported savings claims.

### Failure: Only a polished frontend exists

Prevention:
Complete the actual backend investigation loop before optional polish.

### Failure: Benchmark accuracy is misleading

Prevention:
Evaluate on held-out house variations, seeds and weather nights; label as synthetic.

### Failure: One person's changes overwrite another's

Prevention:
Unique branches, clear ownership and human merges.

---

# SECTION 21 — THE FIVE-MINUTE DEMONSTRATION

The final presentation should roughly follow this sequence.

## 0:00–0:30 — Problem

"People know their heating bills are high, but not which room is wasting energy or what is causing it."

## 0:30–1:10 — Measure and detect

Show the virtual house with room temperature traces.

Run diagnosis.

Show a suspicious room.

## 1:10–2:30 — Investigation

Show ambiguous results.

Explain two possible causes.

HeatHunter calculates whether another simulated experiment would be informative.

Run the experiment.

Show an updated ranking.

## 2:30–3:15 — Financial decision

Show estimated annual cost and repair payback.

Adjust cost assumptions.

## 3:15–4:00 — Fix and verify

Apply the diagnosed repair.

Compare before and after measurements.

Reveal the actual hidden cause.

## 4:00–5:00 — Validation and credibility

Show held-out simulated benchmark results.

Show one actual SMETER house with real historical data.

Explain limitations and future potential.

Do not misrepresent simulation as real-world validation.

---

# SECTION 22 — ABSOLUTE NON-NEGOTIABLE RULES

1. Do not fabricate data.
2. Do not fabricate benchmark metrics.
3. Do not fabricate sourced prices.
4. Do not leak hidden ground truth.
5. Do not present fit scores as calibrated probabilities.
6. Do not claim a draft is proven solely by temperature.
7. Do not claim simulated accuracy is measured real-world accuracy.
8. Do not portray the extractor-fan model as a validated diagnostic procedure for occupied homes.
9. Do not encourage unsafe depressurization tests.
10. Do not claim that a poor repair must improve thermal performance.
11. Do not add excluded features.
12. Do not change API contracts unilaterally.
13. Do not modify other members' modules.
14. Do not claim tests have passed unless actually run.
15. Do not allow unsupported values to appear as verified results.
16. Do not perform final demo operations that require an internet connection.
17. Do not let optional visual polish delay the diagnostic loop.
18. Do not assume published file schemas without inspecting them.
19. Do not mix measurement provenance categories.
20. Do not overstate scientific certainty.

---

# SECTION 23 — BEGIN EXECUTION NOW

You have the full HeatHunter architecture, UX specification, scientific equations, contracts, work allocation and execution sequence.

Now act as the engineering agent for TEAM_MEMBER.

Perform these actions in order.

1. Read the selected team member's section carefully.
2. Inspect the repository and current Git state.
3. Read `AGENTS.md`, `CLAUDE.md` and shared contracts if they already exist.
4. Create or use the correct branch/worktree without overwriting existing changes.
5. Check which assigned milestones are already completed.
6. Identify the very next uncompleted task belonging to TEAM_MEMBER.
7. Implement that task in actual source code.
8. Write tests.
9. Run tests and inspect failures.
10. Fix failures within your ownership.
11. Commit changes.
12. Report the results and interfaces.
13. Continue with the next assigned milestone if time and dependencies permit.

Do not respond by merely summarizing this prompt.

Do not implement the entire project as one agent.

Do not work on the other three members' tasks.

Your goal is to deliver **your own complete, correctly integrated engineering workstream** so that the four independent contributions form one coherent and credible HeatHunter application.

**START IMPLEMENTING YOUR ASSIGNED WORKSTREAM NOW.**
