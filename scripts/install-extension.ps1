<#
.SYNOPSIS
  Install the RavenNow browser extension without a browser store.

.DESCRIPTION
  Downloads the latest RavenNow extension zip from GitHub, unpacks it to a
  stable folder under %LOCALAPPDATA%\RavenNow\extension, and opens the browser
  extensions page so you can click "Load unpacked".

.PARAMETER ZipUrl
  Override the download URL. Defaults to the latest GitHub release asset.

.PARAMETER Destination
  Where to unpack. Defaults to %LOCALAPPDATA%\RavenNow\extension.

.PARAMETER NoLaunch
  Do not open the folder or the browser extensions page.

.EXAMPLE
  irm https://raw.githubusercontent.com/mithustar39/ravennow/main/scripts/install-extension.ps1 | iex
#>
[CmdletBinding()]
param(
  [string]$ZipUrl = "https://github.com/mithustar39/ravennow/releases/latest/download/ravennow-extension.zip",
  [string]$Destination,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

if (-not $Destination) {
  $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME ".local\share" }
  $Destination = Join-Path $base "RavenNow\extension"
}

Write-Host "RavenNow installer" -ForegroundColor Cyan
Write-Host "Downloading the extension..."

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("ravennow-" + [guid]::NewGuid().ToString("n") + ".zip")
Invoke-WebRequest -Uri $ZipUrl -OutFile $tmp -UseBasicParsing

Write-Host "Unpacking to $Destination"
if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
Expand-Archive -Path $tmp -DestinationPath $Destination -Force
Remove-Item $tmp -Force

if (-not (Test-Path (Join-Path $Destination "manifest.json"))) {
  throw "manifest.json was not found after unpacking. The download may be incomplete."
}

Write-Host ""
Write-Host "Done. The extension is in:" -ForegroundColor Green
Write-Host "  $Destination"
Write-Host ""
Write-Host "Now load it:" -ForegroundColor Cyan
Write-Host "  1. Open chrome://extensions or edge://extensions"
Write-Host "  2. Turn on Developer mode (top right)"
Write-Host "  3. Click 'Load unpacked' and pick the folder above"
Write-Host ""

$pages = @{ "chrome" = "chrome://extensions"; "msedge" = "edge://extensions" }
if (-not $NoLaunch) {
  try { Start-Process explorer.exe -ArgumentList $Destination } catch {}
  foreach ($browser in @("chrome", "msedge")) {
    try {
      Start-Process $browser -ArgumentList $pages[$browser] -ErrorAction Stop
      break
    } catch {}
  }
}
