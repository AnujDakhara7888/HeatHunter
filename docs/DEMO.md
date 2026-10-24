# HeatHunter demo guide

## Run it (offline, one process)

```bash
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
cd frontend && npm install && npm run build && cd ..
.venv/bin/uvicorn backend.app.main:app --port 8000
# open http://127.0.0.1:8000
```

FastAPI serves the built frontend from `frontend/dist`. After installation the
demo needs no network: weather, the SMETER HH09 house, the public template,
thresholds and fonts are all local. The only external links are the source
citations in the Evidence drawer.

For frontend development, run the API as above and `npm run dev` in
`frontend/` (Vite proxies `/api` to port 8000).

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

| Tab | Data | Label shown |
|---|---|---|
| Fault Lab | Approximate HH09-inspired digital twin. Synthetic indoor observations from the hidden-fault simulator, with SMETER-station weather (interpolated to 5 min). | `APPROXIMATE HH09 DIGITAL TWIN` |
| Real Homes | Genuine HH09 room temperatures, the original floor plan, and matching SMETER weather. No fault labels. | `REAL HH09 MEASUREMENTS` |

The header shows `Reference house: SMETER HH09` on both tabs. The twin
schematic draws room proportions from the dimensions printed on the published
plan; it is labelled a schematic. Bathroom and closets are shown hatched as
"not modelled".

## Guided scenario: how the seed was chosen (disclose this)

The guided scenario plants a draft (air leak, excess multiplier 2.0) in the HH09
Bedroom. `python -m backend.app.demo_seed_scan --seeds 120` runs that exact
fault through the live pipeline on TRAINING seeds 1–120 and writes
`shared/fixtures/guided_seed_scan.json`:

| Outcome arc | Seeds |
|---|---|
| ambiguous → test → ambiguous | 39 |
| ambiguous → test → confident | 25 |
| no_fault (missed) | 21 |
| ambiguous → no test recommended | 15 |
| confident without test | 13 |
| ambiguous → test → unexplained | 7 |

The final diagnosis matched the hidden fault in **3/120** seeds (40, 65, 68).
All 22 confident-but-wrong results chose envelope conduction (17 in the correct
room). The guided demo uses **seed 68** because it shows every workflow step.
The UI states this in the guided banner and in the Evidence drawer. Every
number on screen is still computed live; nothing is scripted. Use Judge mode
to show unselected cases.

These rates use the provisional TRAINING thresholds and are not the held-out
benchmark (that belongs to the evaluation workstream).

### What seed 68 shows (verified 2026-10-24)

1. Passive night: **ambiguous**, Bedroom flagged. Conduction leads draft by
   6.2 BIC, and the ambiguity threshold is 51.6.
2. E1 fan test: **recommended**, separation 2.68σ against a 2.0σ threshold.
3. After the test: **confident draft**, gap 54.3 BIC, leakage ×2.66.
4. Money at sourced defaults: ≈ £67/yr, 847 kWh gas, payback ≈ 3.3 yr.
5. Seal leaks at 100%: paired mean +2.04 °C, and the post-repair status is
   `no_fault`. Re-measured saving ≈ 860 kWh/yr.
6. Reveal: draft · Bedroom · ×3.0 · matched · repair addressed the cause.

## Five-minute script

| Time | Action | Say |
|---|---|---|
| 0:00–0:30 | Fault Lab, empty | "People know their bills are high, not which room is wasting heat or why. HeatHunter is a check-engine light for a house." |
| 0:30–1:10 | **Guided demo**, then press ▶ on the playback bar, then **Analyze house** | "We used a real measured English bungalow, SMETER HH09, to build an approximate digital twin and injected a hidden fault. Heating off, one cold night. The Bedroom is flagged." |
| 1:10–2:30 | Diagnosis panel, then **Run recommended test** | "An air leak and extra conduction both explain this curve. That's honest ambiguity. HeatHunter predicts an exhaust-fan test would separate them, and only recommends it because the predicted difference exceeds the noise. After the test: confident draft." Point at the before/after box and the safety note. |
| 2:30–3:15 | Cost panel: drag the tariff and repair-cost sliders | "Screening estimate from sourced UK assumptions: Ofgem tariff, HH09's boiler efficiency, local degree-days. Repair prices are flagged unverified." |
| 3:15–4:00 | **Apply fix**, Repaired tab, then **Reveal answer** | "We apply the *diagnosed* repair, not the true one, and re-simulate with identical weather and sensor noise. Anomaly cleared. Reveal: it was a draft in the Bedroom." |
| 4:00–5:00 | Evidence drawer, then Real Homes | "Full transparency: this guided seed was selected, and only 3 of 120 seeds get this fault fully right. Here is the real HH09 data: floor plan, measured HTC of 172 W/K, airtightness. No fault claimed for the real house." |

Backup line if asked about accuracy: the held-out benchmark is produced by the
evaluation workstream. The drawer shows it once `reports/evaluation/summary.json`
exists and says so plainly until then.

## Judge mode

**Judge mode**: choose air leak / conduction / no fault, a room and a
severity, then **Seal fault & start blind investigation**. The dialog closes and
the choice is not kept in UI state. The backend stores it only in the private
truth store. Then run the same workflow. If a confident diagnosis is wrong,
**Apply fix** changes nothing measurable and the repair panel says so.

**Surprise me** draws a random hidden fault, room and severity server-side.

## Pre-demo checklist

- [ ] `.venv/bin/pytest` and `.venv/bin/ruff check backend` pass.
- [ ] `cd frontend && npm run build` succeeds; the API serves `/`.
- [ ] Footer shows `API ONLINE` with Wi-Fi off.
- [ ] Guided path reaches Reveal = matched (seed 68).
- [ ] Judge mode: conduction/Living Room/2.0 diagnoses confident.
- [ ] Surprise me and Reset work; Real Homes loads the plan and charts.
- [ ] No hidden fault is visible before Reveal (API tests check payloads).
- [ ] Evidence drawer opens; benchmark state is honest.
- [ ] Record a backup video of the guided path.
