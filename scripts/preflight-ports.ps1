$ErrorActionPreference = "Stop"
$ports = [ordered]@{
    18701 = "ui"
    4010  = "schedule"
    4000  = "realtime"
    18732 = "timescaledb"
}
$bad = @()
foreach ($port in $ports.Keys) {
    $listen = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    foreach ($row in $listen) {
        $bad += "LISTEN $($ports[$port]) port $port pid $($row.OwningProcess)"
    }
    $lines = @(docker ps -a --filter "publish=$port" --format "{{.ID}} {{.Status}} {{.Names}}")
    foreach ($line in $lines) {
        if ($line -and $line -notmatch "f1analytics-") {
            $bad += "CONTAINER $line publishes $($ports[$port]) port $port"
        }
    }
}
if ($bad.Count -gt 0) {
    $bad | Write-Host
    exit 1
}
Write-Host "ports free: $($ports.Keys -join ', ')"
