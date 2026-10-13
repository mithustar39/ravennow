# Point the extension at your deployed RavenNow server.
#
#   .\scripts\configure-extension.ps1 https://ravennow.example.com
#
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ApiBase
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$python = Join-Path $here "..\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

& $python (Join-Path $here "configure-extension.py") $ApiBase
