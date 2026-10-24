# Synthetic benchmark protocol

HeatHunter evaluation is an independent execution/reporting layer owned by
Anuj. Mihir owns scenario generation and diagnosis logic, including threshold
tuning. The benchmark runner must not inspect hidden truth until after each
diagnosis has been recorded.

## Required held-out design

- Use at least 60 held-out scenarios if runtime permits.
- Include healthy, draft, and envelope-conduction cases.
- Cover multiple rooms, severities, calm/windy nights, sensor noise, and bounded
  house-parameter variation.
- Use different random seeds, weather nights, and house samples from calibration.
- Never tune thresholds or the public template on held-out outcomes.

## Recorded result per scenario

`backend.evaluation.EvaluationRecord` stores only the fields required to compare
public predictions with truth after the run: actual cause/room, pre-experiment
status/cause/room, whether an experiment was recommended and run, the optional
post-experiment result, and an optional independent baseline outcome.

## Metric definitions

- Fault detection accuracy: healthy→`no_fault` or faulty→a confident fault,
  divided by all held-out scenarios.
- Room identification accuracy: confident correct-room results divided by all
  actually faulty scenarios. Ambiguous/unexplained results count as misses.
- Cause classification accuracy: exact cause match (including healthy→`none`)
  divided by the applicable scenario set.
- Post-experiment cause accuracy: exact cause match only among scenarios where a
  recommended experiment actually ran; the subset denominator must be displayed.
- False-positive rate: confident fault results among actually healthy scenarios.
- Ambiguity and unexplained rates: each status count divided by all scenarios.
- Baseline accuracy: emitted only when every scenario has an independently
  computed baseline result.

Confusion matrices retain `ambiguous` and `unexplained` as explicit predicted
columns instead of forcing them into a fault label.

## Current integration blocker

No scenario or diagnosis implementation exists in this repository yet. Therefore
no benchmark values or `reports/evaluation/summary.json` have been created. The
runner can be connected once Mihir supplies the `ScenarioService` methods in
`backend/app/services.py`. Producing plausible placeholder metrics would violate
the scientific protocol.

When real runs are available, serialize the returned `EvaluationSummary` to
`reports/evaluation/summary.json` and label it exactly:

> Diagnosis accuracy on held-out simulated scenarios.

Never describe it as a real-home field trial.
