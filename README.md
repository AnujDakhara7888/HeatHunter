# HeatHunter

HeatHunter is a physics-guided home thermal diagnostic prototype: a check-engine
light for a house. The core demo uses a controlled four-room simulator, compares
competing heat-loss explanations, recommends an additional experiment only when
it is useful, and verifies the effect of the diagnosed repair.

This is a preliminary diagnostic concept, not a certified building energy audit.
Synthetic benchmark performance must not be presented as real-home accuracy.

## Current state

- **Fault Lab** (approximate HH09 digital twin) and **Real Homes** (real SMETER
  HH09 measurements) in one React app, served by FastAPI for offline demos.
- Every API route is wired to the owners' services: Mihir's hidden-fault
  simulator and diagnosis, Kailash's public engine and money model, and Anuj's
  real-house reader. The held-out benchmark route returns 501 until its report
  exists.
- Canonical Pydantic contracts → OpenAPI → generated TypeScript types.

## Run the demo

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev,assistant]'
(cd frontend && npm install && npm run build)
cp .env.example .env           # optional: put ANTHROPIC_API_KEY in .env for chat + plan reading
.venv/bin/uvicorn backend.app.main:app --port 8000   # http://127.0.0.1:8000
```

Pages: `/` scroll story, `/lab` Fault Lab, `/real` real HH09 week, `/home`
bring your own home. Everything except chat, plan reading and weather lookup
works offline.

Frontend development: run the API, then `cd frontend && npm run dev`
(port 5173, proxied to the API). See `docs/DEMO.md` for the demo script and
the guided-seed disclosure, and `docs/CONTRACTS.md` for the API.

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
