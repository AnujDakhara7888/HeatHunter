# HeatHunter demo guide

## Start the local demo

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev,assistant]'
npm --prefix frontend ci
npm --prefix frontend run build
cp .env.example .env           # optional: OPENAI_API_KEY or ANTHROPIC_API_KEY for the chat
.venv/bin/uvicorn backend.app.main:app --port 8000
```

FastAPI serves the built frontend at `http://127.0.0.1:8000`. For frontend
work, run `npm --prefix frontend run dev`; Vite proxies `/api` to port 8000.
Demo homes need no network. Restarting the backend clears demo homes; real
homes reload from `var/homes`.

The chat needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the environment or the
git-ignored repo-root `.env` (see `.env.example`). With only an OpenAI key it uses
OpenAI; otherwise Claude (`claude-sonnet-5-5`, override with
`HEATHUNTER_ASSISTANT_MODEL`). Floor-plan reading uses Claude. The assistant answers only questions about
HeatHunter and the home it is shown; anything else gets a fixed redirect.
Real homes and weather lookup use Open-Meteo and need internet.

The UI uses API v2 throughout. `/lab` is the demo house: pick a house shape and a
week, then Judge mode (plant a fault) or Healthy house. "Next night" and "Week"
advance the clock, "Run a fan test tonight" settles an unclear cause,
"Seal leaks / Insulate / Other" reports the repair, and "Analytics" shows the
analysis as of any night. `/home` sets up a real home (plan, town, heating-off
hours, sensor CSVs) and can save it as a house shape.

## Live judging script (3 minutes, re-tested 2026-10-25 on current main)

Setup: HH09 house, week **10 Jan – 16 Jan**, **Judge mode**, severity slider at
**×2.8**. With 4 random houses per room and fault (32 runs), the planted room was
named correctly by night 4 in 30 runs; both misses were Living room air leaks
named as weak insulation. At the default ×2.2, air leaks were often slower or
misnamed (insulation faults stayed reliable). Healthy houses in this week:
0 of 10 flagged. In 1 of 4 test houses the Living room picked up a late
"cause unclear" flag on night 7, so stop after 2–3 nights instead of running
the full week. Avoid the 17 Jan and 31 Jan weeks (3 of 10 healthy houses
falsely flagged).

So suggest a Kitchen or Bedroom air leak, or any insulation fault, at ×2.8.

1. **Landing (10 s).** One sentence: "HeatHunter finds which room is losing
   heat, and why, from cheap temperature sensors."
2. **Fault Lab → HH09 → 10 Jan – 16 Jan → Judge mode (20 s).** The judge picks
   the room, the fault and ×2.8 in secret and clicks "Hide it & start". "The
   app never sees this; it never leaves the simulator."
3. **Next night ×2–3 (30 s).** "Each night we fit three physics models to every
   room. A leak gets worse with wind, a wall doesn't." A room turns orange:
   flagged after two nights in a row. If it says "cause unclear", press
   "Run a fan test tonight".
4. **Thermal (10 s).** Drag the house; the crosshair reads each room.
5. **Analytics (40 s).** *What happened*: verdict, "How it unfolded", the
   suspects and the cost. Then *Under the hood*: "the cause gap is how it
   names the cause."
6. **Repair (20 s).** House → "Seal leaks" (or "Insulate") → Next night twice →
   "Fixed". Ask the judge: "Was that what you planted?"
7. **Learning and limits (20 s).** "One night couldn't separate a leak from a
   weak wall (3 of 32), so we redesigned around watching night after night. The
   house is simulated on real weather; real sensors are next."

Before judging: restart the server, warm it up with one round, have the backup
video ready. If a night ever takes too long, the app stops after 30 s with a
message; press Next night again, or reload and reopen the house from "Your
houses".

## The story

"HeatHunter watches a home night after night. When a room loses more heat than
it should, it tells you which room, the likely cause, what it costs and what to
do. You fix it yourself, and HeatHunter confirms the fix worked."

The demo house is an approximate digital twin of SMETER house HH09 (a real UK
bungalow), or another house shape, with a fault planted in secret by a judge.
Its nights use real weather from the held-out winter 2020-21, which the flag
rule never saw during tuning.

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
PY
```

Expected: the Bedroom is `watching` after night 1 and an `issue` (air leaks)
from night 2. After the fix it is `verifying`, then `resolved`.
`backend/app/tests/test_homes_v2.py` checks this
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
6. In Judge mode the audience plants the fault, so they can check the app's
   answer themselves; the app is never told it.

## Historical material

`shared/fixtures/guided_seed_scan.json` and the single-night decision settings
(`backend/diagnosis/decision_settings.json`) belong to the retired single-night
Fault Lab. Keep them as research history; do not present them as current
results.

## Freeze checklist

- Run the full pytest suite and Ruff.
- Verify the checked-in OpenAPI matches the app (a test does this).
- Walk a planted leak, a planted envelope fault and a healthy house through
  the UI.
- Verify no planted-fault information appears anywhere in the app or chat.
- Restart the backend and repeat a demo loop without network access.
- Run the held-out benchmark (winter 2020-21) and record a backup video.
