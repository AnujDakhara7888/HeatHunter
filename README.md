# HeatHunter

HeatHunter is a physics-guided home thermal diagnostic prototype: a check-engine
light for a house. The core demo uses a controlled four-room simulator, compares
competing heat-loss explanations, recommends an additional experiment only when
it is useful, and verifies the effect of the diagnosed repair.

This is a preliminary diagnostic concept, not a certified building energy audit.
Synthetic benchmark performance must not be presented as real-home accuracy.

## Current foundation

- Canonical Pydantic v2 contracts and complete FastAPI/OpenAPI route surface.
- Schema-valid, clearly synthetic integration fixtures.
- Eight cached NOAA cold-weather nights with offline readers.
- Explicit ownership boundaries in `AGENTS.md`.

## Backend setup

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn backend.app.main:app --reload
```

OpenAPI is available at `http://127.0.0.1:8000/openapi.json`; interactive docs
are at `/docs`. Only `/api/health` has real behavior in the foundation scaffold.
Scientific endpoints return `501` until their owning services are integrated.

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
