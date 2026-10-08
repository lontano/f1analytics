$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$config = Join-Path $root "cloudflared\config.yml"
cloudflared tunnel --config $config run
