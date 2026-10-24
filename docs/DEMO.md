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

## Run it with nothing installed

**GitHub Codespaces:** on the repository page choose **Code → Codespaces →
Create codespace on this branch**. `.devcontainer/devcontainer.json` installs
the backend, builds the frontend and starts the server. Port 8000 opens in a
browser tab, and the whole thing runs on GitHub's machines. A public link
instead needs the container deployment below.

## Put it on the web (one container)

HeatHunter needs its Python backend (simulator, fitting, in-memory scenarios),
so static hosting alone (GitHub Pages, plain Netlify/Vercel) cannot run it. The
root `Dockerfile` builds the frontend and serves everything from one FastAPI
process on `$PORT`.

```bash
docker build -t heathunter .
docker run -p 8000:8000 heathunter        # or -e PORT=... ; open http://localhost:8000
```

Any Docker host works (Render, Railway, Fly.io, a VM). Constraints:

- **Exactly one instance and one worker.** Scenarios and hidden truth live in
  process memory; a second instance would not know another's scenario IDs.
- A restart clears all scenarios, so users simply start a new one.
- Free tiers that sleep add a cold start of about a minute. Open the site
  before presenting, or use a non-sleeping plan.
- Keep the judged demo on a local run as well (offline requirement).

## Public website vs. researcher console

`/` is the homeowner website. It has a landing page, a "Tell us about your
home" form, a home picker and the check itself.

- **Intake form:** visibly marked *coming soon*. Analysing an uploaded home
  needs new backend work, so the form is disabled and **Skip — use an example
  home** is the only action. Nothing a visitor types is used or sent.
- **Example homes:**
  - **Guided** runs the same seeded scenario as before.
  - **Mystery home** is a surprise scenario.
  - **Set a challenge** is Judge mode in plain words: Mild/Moderate/Severe map
    to excess multipliers 0.6/1.5/3.0.
- **The check** runs as a sequence:
  - Evening: heating on, warm windows.
  - Night: heating off, the roof lifts, and the thermal view plays back the
    simulated readings.
  - The diagnosis runs automatically.
  - The fan test and the fix each replay their night before the result
    appears.
- **On-screen effects:**
  - Blue particles mean cold air coming in (a diagnosed draft).
  - Orange particles mean heat escaping (diagnosed poor insulation).
  - Both mean "not sure".
  - The effects follow the public diagnosis, never the hidden truth.
- **Illustration only:** the brick, roof tiles, garden, chimney placement and
  furniture are decorative. Room sizes and windows come from the published
  plan, and every temperature and result comes from the API.
- **No developer terms** (BIC, provenance, codes) appear. Each result says in
  plain words that the home is a simulation planted for the demo.

Additional homeowner features, all frontend-only and computed from API data:

- **Outside weather card:** outdoor temperature and wind (m/s, mph and the
  Beaufort name), with sparklines and a playback marker. The 3D trees sway in
  proportion to the measured wind speed. Wind direction is not in the API, so
  nothing shows direction.
- **"Why we think so":** the flagged room against the average of the other
  rooms for each night. The sentences (overnight drop, and drop while the fan
  ran) are computed from the readings.
- **Home Heat Report:** a printable one-page report (browser "Save as PDF")
  with the result, cost, tested fix, why-charts, next steps and the demo
  answer.
- **A real week in 3D:** the real SMETER HH09 readings (18–24 Feb 2021)
  replayed in the same house. It is labelled *Real measurements*, the sky
  follows the real time of day, and no fault is claimed.
- **Hero photo (optional):** add a licensed house photo at
  `frontend/src/assets/hero-house.jpg`. Without one, the 3D house is shown.

The original console (Fault Lab, Real Homes, Evidence, Simple/Expert) stays
at **`/#/lab`**, linked as "Researcher view" in the site footer. Use it for
judging and scientific Q&A.

## Simple and Expert views (scope change approved 2026-10-24)

The integration owner (Nikhil) explicitly approved a **Three.js 3D house**,
which the frozen v3 spec had excluded, together with a homeowner-friendly
**Simple** view.

- **Simple** (default): a step tracker (Measure → Find → Test → Fix → Reveal)
  and one plain-English assistant card with a single main action per step.
  - Every number still comes from the API; only the wording is simplified.
  - Ranked causes say "slightly closer fit", never a probability.
- **Expert:** the full scientific dashboard (BIC, thresholds, provenance,
  audit log).
- Both views share one live investigation, so switching never loses progress.
- **3D:** the twin is built from the same plan geometry as the 2D schematic
  and the assumed 2.4 m ceiling.
  - It is lazy-loaded, and rendering pauses while a dialog is open.
  - It falls back to the 2D plan when WebGL is unavailable or fails.
  - Labels are plain DOM, and nothing is fetched online.
- A three-step welcome tour explains real house → hidden problem →
  investigation. It shows once per browser and reopens from "How it works".

## What each tab is
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

The frontend's selection/copy remains a separate workstream. Its current default
`hh09-guided-v1` is the uncertainty example; the full-loop insulation example is
available through the API above. Historical provisional labels and old seed-scan
copy in technical UI panels need integration-owner refresh before presentation.
No frontend files are changed by this backend integration step.

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
