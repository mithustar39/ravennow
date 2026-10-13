# Start the RavenNow API locally (with reload). Builds the frontend on first run.
#
#   .\scripts\dev.ps1          # build frontend if missing, then run API
#   .\scripts\dev.ps1 -Build   # force a frontend rebuild
#   .\scripts\dev.ps1 -Frontend # also start the Vite dev server (hot reload)

param(
    [switch]$Build,
    [switch]$Frontend
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtualenv..."
    python -m venv .venv
}
& ".\.venv\Scripts\python" -m pip install -q -r requirements.txt

if ($Build -or -not (Test-Path "backend\static\index.html")) {
    Write-Host "Building frontend..."
    Push-Location frontend
    npm install
    npm run build
    Pop-Location
}

if ($Frontend) {
    Write-Host "Starting Vite dev server on http://localhost:5173"
    Start-Process -WorkingDirectory "$root\frontend" npm -ArgumentList "run", "dev"
}

Write-Host "Starting API on http://127.0.0.1:8000"
& ".\.venv\Scripts\python" -m uvicorn app.main:app --app-dir backend --reload
