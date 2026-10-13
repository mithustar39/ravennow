# Build the Chrome / Edge Web Store zip from extension/ into dist/.
# The asset is named ravennow-extension.zip so it matches the URL used by the
# install page: https://github.com/<user>/<repo>/releases/latest/download/ravennow-extension.zip

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path $root "extension"
$dist = Join-Path $root "dist"
$version = (Get-Content (Join-Path $ext "manifest.json") -Raw | ConvertFrom-Json).version
$zip = Join-Path $dist "ravennow-extension.zip"

New-Item -ItemType Directory -Path $dist -Force | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $ext "*") -DestinationPath $zip

Write-Host "Built $zip (v$version)"
