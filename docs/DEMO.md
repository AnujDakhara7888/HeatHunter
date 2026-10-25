# HeatHunter demo guide

## Start the local demo

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
npm --prefix frontend ci
npm --prefix frontend run build
.venv/bin/uvicorn backend.app.main:app --port 8000
```

FastAPI serves the built frontend at `http://127.0.0.1:8000`. For frontend
work, run `npm --prefix frontend run dev`; Vite proxies `/api` to port 8000.
After dependencies are installed, weather, real-home data, the public model,
saved decision settings and fonts are cached locally. Source links are optional.
Restarting the backend clears its in-memory scenarios; start a new run afterward.

## Current scientific configuration

The API uses the same `build_runtime_components()` factory as the offline
simulator workflow. It validates the saved public-model/twin/weather/policy
fingerprints, then constructs one shared service. Initial diagnoses use the
`passive` profile; combined observations use `post_fan`. Every returned diagnosis
discloses its phase and exact settings. No startup calibration or PoC fallback
occurs. Invalid configuration returns 501 for scientific routes.

`HEATHUNTER_THRESHOLDS_PATH`, if set, must point to the full versioned decision
settings document. Historical flat threshold files are no longer accepted.

## Two separate guided examples

| ID | What it demonstrates |
|---|---|
| `hh09-guided-insulation-v1` | Curated TRAINING example: Hall, wall heat loss, seed 961029. Ambiguous → recommended calm fan → correct conduction diagnosis → repair → no-fault recheck. |
| `hh09-guided-v1` | Original Bedroom draft example, seed 20261024. The cause stays uncertain after the test; no repair or money estimate is forced. |

The API preserves each example's default seed and any explicit caller override.
Overrides can change the outcome. Both examples use real historical HH09-region
weather with synthetic indoor observations; neither establishes a defect in real
HH09. Their planted faults remain inaccessible to the diagnostic engine.

The insulation example uses passive weather `smeter-hh09-2020-12-06` and fan
weather `smeter-hh09-2019-12-01`. Fan eligibility requires station wind <=2 m/s
through the simulated fan interval. This is a project assumption, not ISO
compliance or a validated procedure for occupied homes.

## Reproduce the full loop through the API

With the backend running, execute from the repository root:

```bash
.venv/bin/python - <<'PY'
import json
from urllib.request import Request, urlopen

base = 'http://127.0.0.1:8000/api'
def call(path, body=None):
    request = Request(base + path, data=None if body is None else json.dumps(body).encode(),
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=60) as response:
        return json.load(response)

created = call('/scenarios', {'mode': 'guided', 'guided_scenario_id': 'hh09-guided-insulation-v1'})
path = '/scenarios/' + created['scenario_id']
call(path + '/observations')
first = call(path + '/diagnose', {})
assert first['status'] == 'ambiguous' and first['test_decision']['recommended']
experiment = call(path + '/experiments', {
    'diagnosis_id': first['diagnosis_id'], 'experiment_type': 'exhaust_fan_depressurization'})
updated = experiment['updated_diagnosis']
assert updated['status'] == 'confident'
assert updated['ranked_causes'][0]['fault_type'] == 'envelope_conduction'
money = call(path + '/money', {'diagnosis_id': updated['diagnosis_id']})
assert money['estimate'] is not None
repair = call(path + '/repair', {'diagnosis_id': updated['diagnosis_id'], 'effectiveness': 1.0})
assert 'status: no_fault' in repair['diagnosed_improvement']
truth = call(path + '/reveal')
assert truth['diagnosis_matched'] and truth['repair_addressed_cause']
print(json.dumps({'before': first['status'], 'after': updated['status'],
                  'repair': repair['diagnosed_improvement'],
                  'matched': truth['diagnosis_matched']}, indent=2))
PY
```

The regression test `backend/app/tests/test_final_runtime.py` also verifies the
full flow, the unresolved draft example, phase disclosures, seed preservation,
stale repair rejection, safe retries, and malformed configuration rejection.
No fit scores or success statuses are hardcoded into the diagnosis.

## The 3D experience (rebuilt UI, 2026-10-25)

The frontend was rebuilt from scratch around a real-time 3D model of HH09
(react-three-fiber). Walls, windows and doors are generated from
`shared/homes/hh09_plan.json`, the same plan format users upload, so any home
gets the same treatment. Routes:

| Route | What it is |
|---|---|
| `/` | Scroll story. Scrolling scrubs the real HH09 night of 18 Feb 2021 through the floor heat map and flies the camera: outside → open house → thermal → fan test → walk-in. |
| `/lab` | Fault Lab. Guided night, Surprise me (random seed) or Judge mode (a judge plants the fault). Night → Diagnose → Fan test → Fix → Reveal, all live API calls. |
| `/real` | A week of real HH09 readings in 3D, plus "screen a real night" using the same engine. |
| `/home` | Bring your own home: upload a plan (Claude reads it) or draw/trace rooms, add CSV or hand-typed readings, fetch weather, then screen it. |

Trust features judges can check:

- **Engine trace** (bottom left) lists every API call with its timing and result.
- **Suspect cards** draw each hypothesis's fitted curve against the measured one.
  The curves come from `POST /api/insight/fits`, which re-runs the engine's own
  fit; its BIC matches `/diagnose` exactly (tested).
- **Surprise me / Judge mode** give a different answer on every run.
- The assistant (`Ask HeatHunter`) sees only what is on screen; truth reaches it
  only after the reveal.

Optional online features: set `ANTHROPIC_API_KEY` (in the environment or in the
git-ignored repo-root `.env`, see `.env.example`) before starting uvicorn to
enable chat and floor-plan reading (model `claude-sonnet-5-5`, override with
`HEATHUNTER_ASSISTANT_MODEL`). Without it, chat answers offline from the engine
output on screen and plans are traced by hand. The chat answers only questions
about HeatHunter and the home on screen; anything else gets a fixed redirect.
Weather lookup uses Open-Meteo and needs internet; readings can always be typed by hand. The judge demo
(`/`, `/lab`, `/real`) needs no network.

### 3-minute pitch script

1. **0:00 `/` hero.** "A check-engine light for your home." Scroll once: the
   real HH09 bungalow cools room by room through the night.
2. **0:30 `/lab` → Judge mode.** Ask a judge to pick a room and a fault. Start.
   The night plays; point at the engine trace: this is computed now.
3. **1:00 Analyze.** One room's bar crosses the alarm tick. Three suspects are
   fitted; if leak and insulation tie, the gauge says *Ambiguous*.
4. **1:30 Fan test.** Air streams through the house. The suspect that can't
   follow the fan night drops out, or the engine honestly says it still can't tell.
5. **2:00 Fix.** Price sliders, payback, then re-run the same night after the
   fix. Before/after toggle.
6. **2:30 Reveal.** The judge's own choice is shown with ✓/✕. Close on `/home`:
   upload any floor plan and it becomes this 3D house.

## What to explain during a presentation

1. This is an approximate model informed by a real home, not an exact replica.
2. One night can show unusual cooling without identifying its cause.
3. The model recommends another simulated test only when it predicts useful evidence.
4. In the selected insulation example, the test identifies wall heat loss.
5. Apply the diagnosed repair and compare new readings with identical weather.
6. Reveal the planted fault after recording the result. Explain that this example
   was selected from TRAINING data and is not a benchmark.
7. Show the unresolved draft example to make the system's limitations visible.

Real Homes uses actual HH09 indoor readings and its original plan. It has no
verified room-level fault labels. Money values are screening estimates under
stated UK assumptions, not audited savings or measured annual bills.

## Historical seed scan and remaining work

`shared/fixtures/guided_seed_scan.json` is a historical snapshot made with the
old provisional rules. Its 3/120 matching count and seed-68 success story do not
describe the current conservative configuration. Preserve the file as historical
research; do not present it as current or held-out accuracy.

The rebuilt frontend's "Guided night" uses `hh09-guided-insulation-v1`. The
uncertainty example `hh09-guided-v1` is reachable through the API; judge mode
shows the same honesty live when the engine cannot separate the causes.

Anuj's independent >=60-case held-out benchmark and final report are still
pending. `/api/evaluation/summary` returns 501 until that report exists. Report
misses and uncertainty explicitly; do not retune on the held-out outcomes.

## Freeze checklist

- Run the full pytest suite and Ruff.
- Verify OpenAPI still matches the checked-in schema.
- Exercise both guided examples, seeded judge mode and surprise mode.
- Verify no ground-truth fields appear before reveal.
- Confirm partial repair and identical retries behave correctly.
- Restart the backend and repeat a guided API loop without external data access.
- Reconcile frontend example selection and scientific labels, then test the UI.
- Complete the held-out report and record a backup presentation video.
