$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath = Join-Path $root '.runtime\state.json'
$rootProcessIds = New-Object System.Collections.Generic.HashSet[int]

if (Test-Path $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    foreach ($id in @($state.app_pid, $state.backend_pid, $state.codex_pid, $state.frontend_pid)) {
        if ($id) { [void]$rootProcessIds.Add([int]$id) }
    }
}

if ($rootProcessIds.Count -gt 0) {
    $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $processIds = New-Object System.Collections.Generic.HashSet[int]
    $queue = New-Object System.Collections.Generic.Queue[int]
    foreach ($rootId in $rootProcessIds) {
        if ($processIds.Add($rootId)) { $queue.Enqueue($rootId) }
    }
    while ($queue.Count -gt 0) {
        $parentId = $queue.Dequeue()
        foreach ($child in $allProcesses | Where-Object { [int]$_.ParentProcessId -eq $parentId }) {
            $childId = [int]$child.ProcessId
            if ($processIds.Add($childId)) { $queue.Enqueue($childId) }
        }
    }
    $orderedIds = @($processIds)
    [array]::Reverse($orderedIds)
    foreach ($processId in $orderedIds) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
Write-Host 'Ocean Intelligence local production services stopped.'
