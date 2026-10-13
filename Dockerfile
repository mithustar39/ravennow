# --- Stage 1: build the shadcn/ui frontend -------------------------------
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
# Vite writes to ../backend/static (see frontend/vite.config.ts).
RUN npm run build

# --- Stage 2: Python runtime --------------------------------------------
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    RAVENNOW_ENV=production

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
# Bring in the built frontend from stage 1.
COPY --from=frontend /app/backend/static ./backend/static

EXPOSE 8000

# Mount a volume at /app/data (or set RAVENNOW_DB) to persist SQLite data.
CMD ["sh", "-c", "uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}"]
