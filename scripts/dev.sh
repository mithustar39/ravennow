#!/usr/bin/env bash
# Start the RavenNow API locally (with reload). Builds the frontend if missing.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ ! -d .venv ]; then
  echo "Creating virtualenv..."
  python3 -m venv .venv
fi
./.venv/bin/python -m pip install -q -r requirements.txt

if [ ! -f backend/static/index.html ]; then
  echo "Building frontend..."
  (cd frontend && npm install && npm run build)
fi

echo "Starting API on http://127.0.0.1:8000"
exec ./.venv/bin/python -m uvicorn app.main:app --app-dir backend --reload
