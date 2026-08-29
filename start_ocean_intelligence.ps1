param(
    [switch]$NoBrowser,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$codexServer = Join-Path $root 'codex-runtime\server\index.mjs'
$runtimeDir = Join-Path $root '.runtime'
$statePath = Join-Path $runtimeDir 'state.json'
$tokenPath = Join-Path $runtimeDir 'codex-mcp-token'
$credentialKeyPath = Join-Path $runtimeDir 'credential-encryption-key'

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

# Provider credentials stay encrypted in the database. The local wrapping key and MCP token stay under .runtime.
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
    'OCEAN_CODEX_BIN'
)) {
    if (-not [Environment]::GetEnvironmentVariable($key, 'Process')) {
        $userValue = [Environment]::GetEnvironmentVariable($key, 'User')
        if ($userValue) {
            [Environment]::SetEnvironmentVariable($key, $userValue, 'Process')
        }
    }
}
if (-not [Environment]::GetEnvironmentVariable('ENCRYPTION_KEY', 'Process')) {
    if (Test-Path -LiteralPath $credentialKeyPath) {
        $credentialKey = (Get-Content -LiteralPath $credentialKeyPath -Raw).Trim()
    } else {
        $credentialBytes = New-Object byte[] 32
        $credentialRng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $credentialRng.GetBytes($credentialBytes)
        } finally {
            $credentialRng.Dispose()
        }
        $credentialKey = [Convert]::ToBase64String($credentialBytes).Replace('+', '-').Replace('/', '_')
        Set-Content -LiteralPath $credentialKeyPath -Value $credentialKey -Encoding ASCII -NoNewline
    }
    [Environment]::SetEnvironmentVariable('ENCRYPTION_KEY', $credentialKey, 'Process')
}
if (-not [Environment]::GetEnvironmentVariable('OCEAN_AGENT_API_MODEL', 'Process')) {
    [Environment]::SetEnvironmentVariable('OCEAN_AGENT_API_MODEL', 'gpt-5.5', 'Process')
}
if (-not (Test-Path -LiteralPath $tokenPath)) {
    $tokenBytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($tokenBytes)
    } finally {
        $rng.Dispose()
    }
    # BitConverter works in Windows PowerShell 5.1 as well as PowerShell 7.
    $token = ([BitConverter]::ToString($tokenBytes) -replace '-', '').ToLowerInvariant()
    Set-Content -LiteralPath $tokenPath -Value $token -Encoding ASCII -NoNewline
}
$mcpToken = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
[Environment]::SetEnvironmentVariable('OCEAN_CODEX_MCP_TOKEN', $mcpToken, 'Process')
[Environment]::SetEnvironmentVariable('OCEAN_CODEX_MCP_URL', 'http://127.0.0.1:8000/api/codex/mcp', 'Process')
[Environment]::SetEnvironmentVariable('OCEAN_CODEX_WORKSPACE', $root, 'Process')

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
            & $candidate -c 'import sys; print(sys.executable)' 2>$null | Out-Null
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
            & $launcher.Source -3 -c 'import sys; print(sys.executable)' 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                return [pscustomobject]@{ File = $launcher.Source; Prefix = @('-3') }
            }
        } catch {
            # A stale py.exe registration must not hide the actionable error below.
        }
    }
    throw 'Python 3.11 or newer was not found.'
}

function Assert-PortFree([int]$Port) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        throw "Port $Port is already in use by process $($listener[0].OwningProcess)."
    }
}

function Wait-Http([string]$Url, [int]$Attempts = 90) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return $true }
        } catch {
            Start-Sleep -Milliseconds 350
        }
    }
    return $false
}

function Test-OceanBackend {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 2
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
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8011/api/codex-runtime/status' -UseBasicParsing -TimeoutSec 3
        $payload = $response.Content | ConvertFrom-Json
        $servers = @($payload.backend.dynamicMcp.namespaces | ForEach-Object { $_.server })
        return $response.StatusCode -eq 200 -and $payload.ready -and $servers -contains 'ocean-intelligence'
    } catch {
        return $false
    }
}

function Stop-StaleOceanCodex {
    try {
        $content = & curl.exe --silent --show-error --max-time 3 'http://127.0.0.1:8011/api/codex-runtime/status'
        if ($LASTEXITCODE -ne 0 -or -not $content) { return $false }
        $payload = $content | ConvertFrom-Json
        if ($payload.mode -ne 'codex-app-server-domain-ui') { return $false }
        $listener = Get-NetTCPConnection -LocalPort 8011 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
        }
        return $true
    } catch {
        return $false
    }
}

function Test-OceanFrontend {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains('/src/main.tsx')
    } catch {
        return $false
    }
}

$backendReady = Test-OceanBackend
$codexReady = Test-OceanCodex
$frontendReady = Test-OceanFrontend

# A backend started before MCP tokenization must be replaced so the sidecar can authenticate.
if ($backendReady -and -not (Test-OceanMcp)) {
    $legacyBackend = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($legacyBackend) { Stop-Process -Id $legacyBackend.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
    $backendReady = $false
}

if (-not $codexReady) {
    [void](Stop-StaleOceanCodex)
}

if (-not $backendReady) { Assert-PortFree 8000 }
if (-not $codexReady) { Assert-PortFree 8011 }
if (-not $frontendReady) { Assert-PortFree 5173 }

$python = Resolve-PythonCommand
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $npm -or -not $node) { throw 'Node.js 20 or newer and npm were not found.' }

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
Push-Location $backendDir
try {
    & $python.File @($python.Prefix) -c 'import fastapi, uvicorn, pydantic, numpy, langgraph; from langgraph.checkpoint.sqlite import SqliteSaver' 2>$null
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

if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
    if ($SkipInstall) { throw 'Frontend dependencies are missing and -SkipInstall was supplied.' }
    Write-Host 'Installing frontend dependencies...'
    & $npm.Source install --prefix $frontendDir
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
}

$backendOut = Join-Path $runtimeDir 'backend.out.log'
$backendErr = Join-Path $runtimeDir 'backend.err.log'
$codexOut = Join-Path $runtimeDir 'codex.out.log'
$codexErr = Join-Path $runtimeDir 'codex.err.log'
$frontendOut = Join-Path $runtimeDir 'frontend.out.log'
$frontendErr = Join-Path $runtimeDir 'frontend.err.log'
Remove-Item -LiteralPath $backendOut, $backendErr, $codexOut, $codexErr, $frontendOut, $frontendErr -Force -ErrorAction SilentlyContinue

$backendArgs = @($python.Prefix) + @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000')
$backendProcess = $null
$codexProcess = $null
$frontendProcess = $null

if (-not $backendReady) {
    $backendProcess = Start-Process -FilePath $python.File -ArgumentList $backendArgs -WorkingDirectory $backendDir -WindowStyle Hidden -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr -PassThru
    $backendReady = Wait-Http 'http://127.0.0.1:8000/api/health'
    if ($backendReady) { $backendReady = Test-OceanMcp }
}

if ($backendReady -and -not $codexReady) {
    $codexProcess = Start-Process -FilePath $node.Source -ArgumentList @($codexServer) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $codexOut -RedirectStandardError $codexErr -PassThru
    $codexReady = Wait-Http 'http://127.0.0.1:8011/api/codex-runtime/status'
}

if ($backendReady -and $codexReady -and -not $frontendReady) {
    $frontendProcess = Start-Process -FilePath $npm.Source -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173') -WorkingDirectory $frontendDir -WindowStyle Hidden -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr -PassThru
    $frontendReady = Wait-Http 'http://127.0.0.1:5173/'
}

if (-not ($backendReady -and $codexReady -and $frontendReady)) {
    foreach ($process in @($backendProcess, $codexProcess, $frontendProcess)) {
        if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    }
    Write-Host 'Backend log:'
    Get-Content -LiteralPath $backendErr -Tail 40 -ErrorAction SilentlyContinue
    Write-Host 'Codex log:'
    Get-Content -LiteralPath $codexErr -Tail 60 -ErrorAction SilentlyContinue
    Write-Host 'Frontend log:'
    Get-Content -LiteralPath $frontendErr -Tail 40 -ErrorAction SilentlyContinue
    throw "Startup failed. Backend: $backendReady; Codex: $codexReady; frontend: $frontendReady."
}

$backendProcessId = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess
$codexProcessId = Get-NetTCPConnection -LocalPort 8011 -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess
$frontendProcessId = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess

[ordered]@{
    started_at = (Get-Date).ToString('o')
    backend_pid = $backendProcessId
    codex_pid = $codexProcessId
    frontend_pid = $frontendProcessId
    backend_url = 'http://127.0.0.1:8000'
    codex_url = 'http://127.0.0.1:8011'
    frontend_url = 'http://127.0.0.1:5173'
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

Write-Host ''
Write-Host 'Ocean Intelligence is running.' -ForegroundColor Green
Write-Host 'Application: http://127.0.0.1:5173/'
Write-Host 'Codex host:  http://127.0.0.1:8011/api/codex-runtime/status'
Write-Host 'API docs:    http://127.0.0.1:8000/docs'
Write-Host "Logs:        $runtimeDir"

if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:5173/' }
