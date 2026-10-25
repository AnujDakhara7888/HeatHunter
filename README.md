# HeatHunter

HeatHunter is a physics-guided home thermal monitor: a check-engine light for a
house. It watches each room night after night while the heating is off, flags a
room that loses more heat than it should, explains whether air leaks or the
walls, roof or floor are the likely cause, estimates the cost, and keeps
watching after a repair to confirm it worked.

This is a preliminary diagnostic concept, not a certified building energy audit.
Synthetic benchmark performance must not be presented as real-home accuracy.

## Current state

- **API v2** (`docs/CONTRACTS.md`): homes monitored night after night. Demo homes
  are an approximate digital twin of SMETER house HH09 with a hidden fault, run
  on real held-out winter weather; real homes take a plan, a location and sensor
  uploads. The Real tab shows real HH09 measurements.
- The flag rule (`backend/diagnosis/monitoring.py`) was tuned on simulated
  training-winter houses; results are in `docs/PHYSICS.md`. The held-out
  benchmark route returns 501 until its report exists.
- Canonical Pydantic contracts → OpenAPI → generated TypeScript types.
- The frontend still calls the removed single-night routes and needs moving to
  API v2.

## Run the demo

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev,assistant]'
(cd frontend && npm install && npm run build)
cp .env.example .env           # optional: put ANTHROPIC_API_KEY in .env for chat + plan reading
.venv/bin/uvicorn backend.app.main:app --port 8000   # http://127.0.0.1:8000
```

Demo homes work offline. Chat supports OpenAI or Claude. For OpenAI, set
`HEATHUNTER_CHAT_PROVIDER=openai` and `OPENAI_API_KEY` in the git-ignored `.env`.
`HEATHUNTER_OPENAI_MODEL` defaults to `gpt-5-nano` with minimal reasoning. Restart the API after changing
configuration. OpenAI API billing is separate from a ChatGPT subscription.
The default Claude chat and floor-plan reading use `ANTHROPIC_API_KEY`.
Real homes and weather lookup need internet (Open-Meteo).
General questions use `/api/assistant/help` before a home is selected; once selected,
chat uses `/api/homes/{home_id}/assistant` with that home's server-built public data.
Each request includes the project guide and preserves uncertainty and simulated-data disclosures.
GPT-5 nano is a budget demo choice scheduled for retirement on December 11, 2026;
configure a supported replacement before then.

Frontend development: run the API, then `cd frontend && npm run dev`
(port 5173, proxied to the API). See `docs/DEMO.md` for the demo script and `docs/CONTRACTS.md`
for the API.

## Verification

```bash
.venv/bin/pytest
.venv/bin/ruff check backend
```

## Generated TypeScript API types

```bash
.venv/bin/python -m backend.app.export_openapi --output frontend/openapi.json
cd frontend
npm install
npm run generate:api
```

Do not hand-maintain duplicate TypeScript API interfaces; regenerate them from
the FastAPI schema.
