param(
    [switch]$NoBrowser,
    [switch]$SkipInstall,
    [switch]$SkipCopernicusCheck
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$frontendDist = Join-Path $frontendDir 'dist'
$codexServer = Join-Path $root 'codex-runtime\server\index.mjs'
$runtimeDir = Join-Path $root '.runtime'
$statePath = Join-Path $runtimeDir 'state.json'
$tokenPath = Join-Path $runtimeDir 'codex-mcp-token'
$tenantSecretPath = Join-Path $runtimeDir 'codex-tenant-secret'
$credentialKeyPath = Join-Path $runtimeDir 'credential-encryption-key'

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

function Set-ProcessEnvironment([string]$Name, [string]$Value) {
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Import-UserEnvironment {
    # Keep the documented Windows user-variable setup compatible with one-click startup.
    foreach ($key in @(
        'ENCRYPTION_KEY',
        'OCEAN_AGENT_API_URL',
        'OCEAN_AGENT_API_KEY',
        'OCEAN_AGENT_API_MODEL',
        'OCEAN_AGENT_API_TIMEOUT_SECONDS',
        'OCEAN_AGENT_API_ATTEMPTS',
        'OCEAN_AGENT_REASONING_EFFORT',
        'OCEAN_AGENT_CIRCUIT_FAILURES',
        'OCEAN_AGENT_CIRCUIT_COOLDOWN_SECONDS',
        'OCEAN_CODEX_BIN',
        'OCEAN_CODEX_RUNTIME_ROOT',
        'COPERNICUSMARINE_USERNAME',
        'COPERNICUSMARINE_PASSWORD',
        'COPERNICUSMARINE_WAVE_DATASET_ID',
        'COPERNICUSMARINE_WIND_DATASET_ID',
        'COPERNICUSMARINE_CURRENT_DATASET_ID',
        'COPERNICUSMARINE_CURRENT_U_VARIABLE',
        'COPERNICUSMARINE_CURRENT_V_VARIABLE',
        'COPERNICUSMARINE_CURRENT_ARCO_URL',
        'VITE_TIANDITU_TOKEN'
    )) {
        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key, 'Process'))) {
            $userValue = [Environment]::GetEnvironmentVariable($key, 'User')
            if (-not [string]::IsNullOrWhiteSpace($userValue)) {
                Set-ProcessEnvironment $key $userValue
            }
        }
    }
}

function New-RandomHex([int]$ByteCount) {
    $bytes = New-Object byte[] $ByteCount
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function New-FernetKey {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')
}

function Ensure-RuntimeSecret([string]$Path, [scriptblock]$Factory) {
    if (Test-Path -LiteralPath $Path) {
        $existing = (Get-Content -LiteralPath $Path -Raw).Trim()
        if (-not [string]::IsNullOrWhiteSpace($existing)) { return $existing }
    }
    $created = & $Factory
    Set-Content -LiteralPath $Path -Value $created -Encoding ASCII -NoNewline
    return $created
}

function Resolve-PythonCommand {
    $candidatePaths = New-Object System.Collections.Generic.List[string]
    $candidatePaths.Add((Join-Path $root '.venv\Scripts\python.exe'))
    $command = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($command) { $candidatePaths.Add($command.Source) }
    $candidatePaths.Add((Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'))
    $uvPythonRoot = Join-Path $env:APPDATA 'uv\python'
    if (Test-Path -LiteralPath $uvPythonRoot) {
        Get-ChildItem -LiteralPath $uvPythonRoot -Directory -Filter 'cpython-3.*-windows-x86_64-none' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { $candidatePaths.Add((Join-Path $_.FullName 'python.exe')) }
    }
    $candidatePaths.Add((Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'))
    foreach ($candidate in $candidatePaths | Select-Object -Unique) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        try {
            & $candidate -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                return [pscustomobject]@{ File = $candidate; Prefix = @() }
            }
        } catch {
            continue
        }
    }
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        try {
            & $launcher.Source -3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                return [pscustomobject]@{ File = $launcher.Source; Prefix = @('-3') }
            }
        } catch {
            # A stale py.exe registration must not hide the actionable error below.
        }
    }
    throw 'Python 3.11 or newer was not found.'
}

function Resolve-ListenerPids([int]$Port) {
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-ProcessTree([int[]]$RootIds) {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $selected = New-Object System.Collections.Generic.HashSet[int]
    $queue = New-Object System.Collections.Generic.Queue[int]
    foreach ($rootId in $RootIds) {
        if ($rootId -gt 0 -and $selected.Add($rootId)) { $queue.Enqueue($rootId) }
    }
    while ($queue.Count -gt 0) {
        $parentId = $queue.Dequeue()
        foreach ($child in $processes | Where-Object { [int]$_.ParentProcessId -eq $parentId }) {
            $childId = [int]$child.ProcessId
            if ($selected.Add($childId)) { $queue.Enqueue($childId) }
        }
    }
    return @($selected)
}

function Stop-ProcessTree([int[]]$RootIds) {
    $treeIds = Get-ProcessTree $RootIds
    [array]::Reverse($treeIds)
    foreach ($processId in $treeIds) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-ManagedRuntime {
    if (-not (Test-Path -LiteralPath $statePath)) { return }
    try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        $managedIds = @($state.app_pid, $state.backend_pid, $state.codex_pid, $state.frontend_pid) |
            Where-Object { $_ } |
            ForEach-Object { [int]$_ } |
            Select-Object -Unique
        if ($managedIds.Count -gt 0) { Stop-ProcessTree $managedIds }
        Start-Sleep -Milliseconds 500
    } finally {
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }
}

function Assert-PortFree([int]$Port) {
    $listeners = Resolve-ListenerPids $Port
    if ($listeners.Count -gt 0) {
        throw "Port $Port is already in use by process $($listeners[0])."
    }
}

function Wait-Http([string]$Url, [int]$Attempts = 120) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return $true }
        } catch {
            Start-Sleep -Milliseconds 350
        }
    }
    return $false
}

function Get-CodexTenantHeaders([string]$OwnerId = 'local-health') {
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
    $payload = "$OwnerId`nGET`nstatus`n$timestamp"
    $hmac = New-Object Security.Cryptography.HMACSHA256
    try {
        $hmac.Key = [Text.Encoding]::UTF8.GetBytes($tenantSecret)
        $signature = ([BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))) -replace '-', '').ToLowerInvariant()
    } finally {
        $hmac.Dispose()
    }
    return @{
        'X-Ocean-Codex-User' = $OwnerId
        'X-Ocean-Codex-Timestamp' = $timestamp
        'X-Ocean-Codex-Signature' = $signature
    }
}

function Test-OceanBackend {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 3
        $payload = $response.Content | ConvertFrom-Json
        return $response.StatusCode -eq 200 -and $payload.service -eq 'ocean-intelligence-agent'
    } catch {
        return $false
    }
}

function Test-OceanMcp {
    try {
        $headers = @{ Authorization = "Bearer $mcpToken" }
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/codex/mcp' -Headers $headers -UseBasicParsing -TimeoutSec 3
        $payload = $response.Content | ConvertFrom-Json
        return $response.StatusCode -eq 200 -and $payload.status -eq 'ready'
    } catch {
        return $false
    }
}

function Test-OceanCodex {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8011/api/codex-runtime/status' -Headers (Get-CodexTenantHeaders) -UseBasicParsing -TimeoutSec 5
        $payload = $response.Content | ConvertFrom-Json
        $contextMcp = @($payload.backend.contextMcps | Where-Object {
            $_.name -eq 'ocean-intelligence' -and $_.configured -eq $true
        })
        $dynamicMcp = @($payload.backend.dynamicMcp.namespaces | Where-Object {
            $_.server -eq 'ocean-intelligence'
        })
        return $response.StatusCode -eq 200 `
            -and $payload.ready `
            -and $contextMcp.Count -gt 0 `
            -and $payload.backend.dynamicMcp.catalogReady -eq $true `
            -and $dynamicMcp.Count -gt 0
    } catch {
        return $false
    }
}

function Test-OceanApp {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/' -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -eq 200 `
            -and $response.Content.Contains('<div id="root">') `
            -and $response.Content.Contains('/assets/') `
            -and -not $response.Content.Contains('/src/main.tsx')
    } catch {
        return $false
    }
}

Import-UserEnvironment

$copernicusUsername = [Environment]::GetEnvironmentVariable('COPERNICUSMARINE_USERNAME', 'Process')
$copernicusPassword = [Environment]::GetEnvironmentVariable('COPERNICUSMARINE_PASSWORD', 'Process')
if ([string]::IsNullOrWhiteSpace($copernicusUsername) -or [string]::IsNullOrWhiteSpace($copernicusPassword)) {
    throw 'Copernicus Marine credentials are required. Set COPERNICUSMARINE_USERNAME and COPERNICUSMARINE_PASSWORD, then reopen PowerShell. See README.md section 7 and 8.2.'
}

$credentialKey = [Environment]::GetEnvironmentVariable('ENCRYPTION_KEY', 'Process')
if ([string]::IsNullOrWhiteSpace($credentialKey)) {
    $credentialKey = Ensure-RuntimeSecret $credentialKeyPath { New-FernetKey }
    Set-ProcessEnvironment 'ENCRYPTION_KEY' $credentialKey
}
$tenantSecret = [Environment]::GetEnvironmentVariable('OCEAN_CODEX_TENANT_SECRET', 'Process')
if ([string]::IsNullOrWhiteSpace($tenantSecret)) {
    $tenantSecret = Ensure-RuntimeSecret $tenantSecretPath { New-RandomHex 32 }
    Set-ProcessEnvironment 'OCEAN_CODEX_TENANT_SECRET' $tenantSecret
}
$mcpToken = Ensure-RuntimeSecret $tokenPath { New-RandomHex 32 }

# Local production is deliberately loopback-only and same-origin.
Set-ProcessEnvironment 'APP_ENV' 'production'
Set-ProcessEnvironment 'LOCAL_ONLY_MODE' 'true'
Set-ProcessEnvironment 'AUTH_REQUIRED' 'true'
Set-ProcessEnvironment 'SESSION_COOKIE_SECURE' 'false'
Set-ProcessEnvironment 'ALLOWED_HOSTS' '127.0.0.1,localhost'
Set-ProcessEnvironment 'ALLOWED_ORIGINS' 'http://127.0.0.1:8000,http://localhost:8000'
Set-ProcessEnvironment 'FRONTEND_DIST_DIR' $frontendDist
Set-ProcessEnvironment 'CODEX_RUNTIME_URL' 'http://127.0.0.1:8011'
Set-ProcessEnvironment 'OCEAN_CODEX_HOST' '127.0.0.1'
Set-ProcessEnvironment 'OCEAN_CODEX_PORT' '8011'
Set-ProcessEnvironment 'OCEAN_CODEX_MCP_TOKEN' $mcpToken
Set-ProcessEnvironment 'OCEAN_CODEX_MCP_URL' 'http://127.0.0.1:8000/api/codex/mcp'
Set-ProcessEnvironment 'OCEAN_CODEX_WORKSPACE' $root
Set-ProcessEnvironment 'VITE_LOCAL_ONLY' 'true'
# Ensure Codex and other child processes do not route loopback MCP calls through a
# machine-wide HTTP proxy. Preserve any existing bypass entries.
$existingNoProxy = [Environment]::GetEnvironmentVariable('NO_PROXY', 'Process')
if ([string]::IsNullOrWhiteSpace($existingNoProxy)) {
    $existingNoProxy = [Environment]::GetEnvironmentVariable('no_proxy', 'Process')
}
$noProxyEntries = @($existingNoProxy -split '[,;]' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$noProxyEntries += @('127.0.0.1', 'localhost')
$noProxyValue = ($noProxyEntries | ForEach-Object { $_.Trim() } | Select-Object -Unique) -join ','
Set-ProcessEnvironment 'NO_PROXY' $noProxyValue
Set-ProcessEnvironment 'no_proxy' $noProxyValue
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('OCEAN_AGENT_API_MODEL', 'Process'))) {
    Set-ProcessEnvironment 'OCEAN_AGENT_API_MODEL' 'gpt-5.5'
}

if (-not (Test-Path -LiteralPath $codexServer)) { throw "Codex runtime entry was not found: $codexServer" }

$python = Resolve-PythonCommand
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $npm -or -not $node) { throw 'Node.js 20 or newer and npm were not found.' }
$nodeVersion = (& $node.Source -p 'process.versions.node').Trim()
if (-not $nodeVersion -or [int]($nodeVersion.Split('.')[0]) -lt 20) {
    throw "Node.js 20 or newer is required. Found: $nodeVersion"
}

$localPythonPath = Join-Path $root '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $localPythonPath) {
    & $localPythonPath -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'The existing .venv does not use Python 3.11 or newer. Recreate .venv with a supported Python version.'
    }
    $python = [pscustomobject]@{ File = $localPythonPath; Prefix = @() }
} else {
    Write-Host 'Creating the local Python environment...'
    & $python.File @($python.Prefix) -m venv (Join-Path $root '.venv')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $localPythonPath)) {
        throw 'The local Python environment could not be created.'
    }
    $python = [pscustomobject]@{ File = $localPythonPath; Prefix = @() }
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
Push-Location $backendDir
try {
    & $python.File @($python.Prefix) -c 'import copernicusmarine, cryptography, fastapi, httpx, langgraph, netCDF4, numpy, opencc, psycopg, pyarrow, pydantic, uvicorn; from langgraph.checkpoint.sqlite import SqliteSaver' 2>$null
    $dependencyProbeExitCode = $LASTEXITCODE
} finally {
    Pop-Location
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($dependencyProbeExitCode -ne 0) {
    if ($SkipInstall) { throw 'Backend dependencies are missing and -SkipInstall was supplied.' }
    Write-Host 'Installing backend dependencies...'
    $ErrorActionPreference = 'Continue'
    try {
        & $python.File @($python.Prefix) -m pip install -r (Join-Path $backendDir 'requirements.txt')
        $dependencyInstallExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($dependencyInstallExitCode -ne 0) { throw 'Backend dependency installation failed.' }
}

if (-not $SkipCopernicusCheck) {
    Write-Host 'Validating Copernicus Marine credentials...'
    $ErrorActionPreference = 'Continue'
    try {
        & $python.File -c 'import os, sys, copernicusmarine; ok = copernicusmarine.login(username=os.environ[''COPERNICUSMARINE_USERNAME''], password=os.environ[''COPERNICUSMARINE_PASSWORD''], check_credentials_valid=True); raise SystemExit(0 if ok else 1)'
        $copernicusCheckExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($copernicusCheckExitCode -ne 0) {
        throw 'Copernicus Marine credential validation failed. Check the account, password, email verification, and outbound HTTPS access. See README.md section 8.2.'
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $frontendDir 'node_modules'))) {
    if ($SkipInstall) { throw 'Frontend dependencies are missing and -SkipInstall was supplied.' }
    Write-Host 'Installing frontend dependencies...'
    if (Test-Path -LiteralPath (Join-Path $frontendDir 'package-lock.json')) {
        & $npm.Source ci --prefix $frontendDir
    } else {
        & $npm.Source install --prefix $frontendDir
    }
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
}

Write-Host 'Building local production frontend...'
Push-Location $frontendDir
try {
    & $npm.Source run build -- --mode local-production
    $buildExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($buildExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $frontendDist 'index.html'))) {
    throw 'Local production frontend build failed.'
}

# Only replace the managed instance after all preflight checks and the production
# build have passed, so a configuration error does not cause avoidable downtime.
Stop-ManagedRuntime
Assert-PortFree 8000
Assert-PortFree 8011
$backendReady = $false
$codexReady = $false

$backendOut = Join-Path $runtimeDir 'backend.out.log'
$backendErr = Join-Path $runtimeDir 'backend.err.log'
$codexOut = Join-Path $runtimeDir 'codex.out.log'
$codexErr = Join-Path $runtimeDir 'codex.err.log'
Remove-Item -LiteralPath $backendOut, $backendErr, $codexOut, $codexErr -Force -ErrorAction SilentlyContinue

$backendProcess = $null
$codexProcess = $null
$backendArgs = @($python.Prefix) + @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--no-access-log')

if (-not $backendReady) {
    $backendProcess = Start-Process -FilePath $python.File -ArgumentList $backendArgs -WorkingDirectory $backendDir -WindowStyle Hidden -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr -PassThru
    $backendReady = Wait-Http 'http://127.0.0.1:8000/api/health'
    if ($backendReady) { $backendReady = Test-OceanMcp -and (Test-OceanApp) }
}

if ($backendReady -and -not $codexReady) {
    $codexProcess = Start-Process -FilePath $node.Source -ArgumentList @($codexServer) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $codexOut -RedirectStandardError $codexErr -PassThru
    for ($attempt = 1; $attempt -le 180 -and -not $codexReady; $attempt++) {
        $codexReady = Test-OceanCodex
        if (-not $codexReady) { Start-Sleep -Milliseconds 500 }
    }
}

if (-not ($backendReady -and $codexReady)) {
    $failedProcessIds = @($backendProcess, $codexProcess) |
        Where-Object { $_ -and -not $_.HasExited } |
        ForEach-Object { [int]$_.Id }
    if ($failedProcessIds.Count -gt 0) { Stop-ProcessTree $failedProcessIds }
    Write-Host 'Backend log:'
    Get-Content -LiteralPath $backendErr -Tail 60 -ErrorAction SilentlyContinue
    Write-Host 'Codex log:'
    Get-Content -LiteralPath $codexErr -Tail 80 -ErrorAction SilentlyContinue
    throw "Local production startup failed. Backend: $backendReady; Codex: $codexReady."
}

$backendProcessId = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess
$codexProcessId = Get-NetTCPConnection -LocalPort 8011 -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess

[ordered]@{
    mode = 'local-production'
    started_at = (Get-Date).ToString('o')
    app_pid = $backendProcessId
    backend_pid = $backendProcessId
    codex_pid = $codexProcessId
    app_url = 'http://127.0.0.1:8000/'
    backend_url = 'http://127.0.0.1:8000'
    codex_url = 'http://127.0.0.1:8011'
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

Write-Host ''
Write-Host 'Ocean Intelligence local production is running.' -ForegroundColor Green
Write-Host 'Application: http://127.0.0.1:8000/'
Write-Host 'Health:      http://127.0.0.1:8000/api/health'
Write-Host 'Codex proxy: http://127.0.0.1:8000/api/codex-runtime/status (after signing in)'
Write-Host 'Logs:        ' $runtimeDir
Write-Host 'Loopback only: no public listener is started.'

if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8000/' }
