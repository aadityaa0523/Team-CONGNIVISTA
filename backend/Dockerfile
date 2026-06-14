# HydroMind FastAPI backend.
# Build context MUST be the repo root (not ./backend) because the app uses
# absolute package imports (`from backend.config import settings`) and is run
# as `backend.main:app`. See infra/docker-compose.yml.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first for layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application package.
COPY backend/ ./backend/

# Drain digital-twin seed data. mongo.seed_drains_if_empty() resolves this to
# /app/data/synthetic_drain_profiles.json (parents[2] of the service module);
# without it, drain seeding silently fails and the dashboard shows no drains.
COPY data/ ./data/

# Model pickles (ARIMAX + classifiers) are written here at runtime.
RUN mkdir -p /app/models

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
