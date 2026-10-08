$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
& (Join-Path $PSScriptRoot "preflight-ports.ps1")
docker compose up --build -d --remove-orphans
Write-Host "UI http://127.0.0.1:18701"
