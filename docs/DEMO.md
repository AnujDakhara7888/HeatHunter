# HeatHunter demo guide

## Start the local demo

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev,assistant]'
npm --prefix frontend ci
npm --prefix frontend run build
export ANTHROPIC_API_KEY=...   # optional: assistant and floor-plan reading
.venv/bin/uvicorn backend.app.main:app --port 8000
```

FastAPI serves the built frontend at `http://127.0.0.1:8000`. For frontend
work, run `npm --prefix frontend run dev`; Vite proxies `/api` to port 8000.
Demo homes need no network. Restarting the backend clears demo homes; real
homes reload from `var/homes`.

The assistant and floor-plan reading need `ANTHROPIC_API_KEY`, set in the
environment or in the git-ignored repo-root `.env` (see `.env.example`). The
default model is `claude-sonnet-5-5`; override it with
`HEATHUNTER_ASSISTANT_MODEL`. The assistant answers only questions about
HeatHunter and the home it is shown; anything else gets a fixed redirect.
Real homes and weather lookup use Open-Meteo and need internet.

The UI uses API v2 throughout: `/lab` is the demo house (hidden, judge-planted or
no fault; "Next night" advances, rooms change status, "I sealed leaks / I
insulated" reports the repair, Reveal at the end), `/home` sets up a real home
(plan, town, heating-off hours, sensor CSVs), and `/real` replays the real HH09
week (heating on, so not monitored).

## The story

"HeatHunter watches a home night after night. When a room loses more heat than
it should, it tells you which room, the likely cause, what it costs and what to
do. You fix it yourself, and HeatHunter confirms the fix worked."

The demo house is an approximate digital twin of SMETER house HH09 (a real UK
bungalow) with a hidden fault planted by the presenter, a judge, or at random.
Its nights use real weather from the held-out winter 2020-21, which the flag
rule never saw during tuning. The real HH09 week is shown separately in the
Real tab; its heating was on, so it is not monitored.

## Walk the loop through the API

With the backend running, from the repository root:

```bash
.venv/bin/python - <<'PY'
import json
from urllib.request import Request, urlopen

base = "http://127.0.0.1:8000/api"
def call(path, body=None):
    request = Request(base + path, data=None if body is None else json.dumps(body).encode(),
                      headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=120) as response:
        return json.load(response)

home = call("/demo/homes", {"fault": {"type": "draft", "room_id": "bedroom_1", "severity": 1.2},
                            "seed": 4242})["home_id"]
for night in range(3):
    health = call(f"/demo/homes/{home}/advance", {"nights": 1})
    print(night + 1, [(r["name"], r["status"]) for r in health["rooms"]])
report = call(f"/homes/{home}/rooms/bedroom_1")
print(report["headline"], *report["why"], sep="\n  ")
call(f"/homes/{home}/rooms/bedroom_1/fix", {"action": "seal_leaks"})
for night in range(2):
    health = call(f"/demo/homes/{home}/advance", {"nights": 1})
print([(r["name"], r["status"]) for r in health["rooms"]])
print(call(f"/demo/homes/{home}/reveal")["summary"])
PY
```

Expected: the Bedroom is `watching` after night 1 and an `issue` (air leaks)
from night 2. After the fix it is `verifying`, then `resolved`. The reveal says
it was found after 2 nights. `backend/app/tests/test_homes_v2.py` checks this
flow, a wrong repair (`still_an_issue`), a healthy house and the error cases.

## Numbers you can quote

From `docs/PHYSICS.md` and `reports/monitoring/flag_rule_tuning.json`. These are
simulated training-winter check houses that were never tuned on, not held-out or
real-home accuracy:

- Envelope faults: found with the right room and cause in 35/36 cases, typically
  by night 2-3.
- Air leaks: 30/36, typically by night 3-5. Mild leaks (1.6x) are the hardest:
  8/12.
- 1/24 healthy houses was falsely flagged; 2/72 confident answers were wrong.
- With a single night, only 3/32 air leaks could be told apart from wall heat
  loss. That is why the product watches over several nights.

## What to explain during a presentation

1. The demo house is an approximate model informed by a real home, not a replica.
2. One night shows that a room cools too fast, but not why. Air leaks get worse
   with wind and wall losses do not, so nights of varying weather tell them
   apart.
3. A flag needs two nights in a row; the cause is named only when one
   explanation clearly wins. Otherwise the app says "cause not clear yet".
4. The repair is done by a person, in the room. The app re-judges only nights
   after the fix.
5. Money figures are screening estimates under stated UK assumptions (Ofgem
   price cap, HH09's boiler efficiency), not quotes or audited savings.
6. Reveal the hidden fault only after the app has concluded.

## Historical material

`shared/fixtures/guided_seed_scan.json` and the single-night decision settings
(`backend/diagnosis/decision_settings.json`) belong to the retired single-night
Fault Lab. Keep them as research history; do not present them as current
results.

## Freeze checklist

- Run the full pytest suite and Ruff.
- Verify the checked-in OpenAPI matches the app (a test does this).
- Walk a planted leak, a planted envelope fault, a random fault and a healthy
  house through the UI.
- Verify no planted-fault information appears before reveal.
- Restart the backend and repeat a demo loop without network access.
- Run the held-out benchmark (winter 2020-21) and record a backup video.
