# Single-container HeatHunter deployment: FastAPI serves the API and the built frontend.

# --- Build the frontend ---
FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# The UI imports the guided-seed disclosure from shared/fixtures at build time.
COPY shared/ /app/shared/
RUN npm run build

# --- Runtime ---
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
COPY pyproject.toml ./
COPY backend/ backend/
# Editable install keeps the repository layout the services read data from.
RUN pip install --no-cache-dir -e .
COPY config/ config/
COPY data/ data/
COPY reports/ reports/
COPY shared/ shared/
COPY --from=frontend /app/frontend/dist frontend/dist
EXPOSE 8000
# One worker only: scenarios and hidden truth live in process memory.
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
