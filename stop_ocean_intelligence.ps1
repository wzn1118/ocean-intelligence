$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath = Join-Path $root '.runtime\state.json'
$processIds = New-Object System.Collections.Generic.HashSet[int]

if (Test-Path $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    foreach ($id in @($state.backend_pid, $state.codex_pid, $state.frontend_pid)) {
        if ($id) { [void]$processIds.Add([int]$id) }
    }
}

foreach ($port in @(8000, 8011, 5173)) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        [void]$processIds.Add([int]$listener.OwningProcess)
    }
}

foreach ($processId in $processIds) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
Write-Host 'Ocean Intelligence services stopped.'
