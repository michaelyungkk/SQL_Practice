$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 4173
$url = "http://127.0.0.1:$port"

function Test-AppUrl {
  param(
    [string]$TargetUrl
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $TargetUrl -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Get-NpmCommand {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($null -eq $npm) {
    throw 'npm.cmd was not found. Please install Node.js first.'
  }

  return $npm.Source
}

Set-Location -LiteralPath $root

if (Test-AppUrl -TargetUrl $url) {
  Start-Process $url
  exit 0
}

$npmCommand = Get-NpmCommand

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
  & $npmCommand install
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

$escapedRoot = $root.Replace("'", "''")
$serverCommand = "Set-Location -LiteralPath '$escapedRoot'; & '$npmCommand' run dev -- --host 127.0.0.1 --port $port"

Start-Process powershell.exe `
  -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $serverCommand `
  -WindowStyle Minimized

for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  if (Test-AppUrl -TargetUrl $url) {
    Start-Process $url
    exit 0
  }

  Start-Sleep -Milliseconds 500
}

throw "Analyst Quest did not start within 30 seconds. You can try running '$npmCommand run dev -- --host 127.0.0.1 --port $port' manually."
