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
