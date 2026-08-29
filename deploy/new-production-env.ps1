[CmdletBinding()]
param(
    [string]$Hostname = "ocean.hegelsalon.com",
    [string]$TunnelName = "ocean-intelligence",
    [string]$OutputPath = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot "production.env"
}

if ($Hostname -notmatch '^[a-z0-9.-]+$') {
    throw "Hostname contains unsupported characters."
}
if ((Test-Path -LiteralPath $OutputPath) -and -not $Force) {
    throw "Refusing to overwrite $OutputPath without -Force."
}

$cloudflared = Get-Command cloudflared -ErrorAction Stop
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$tunnelToken = (& $cloudflared.Source tunnel token $TunnelName 2>$null | Out-String).Trim()
$tokenExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction
if ($tokenExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($tunnelToken)) {
    throw "Unable to obtain a token for Tunnel '$TunnelName'."
}

function New-RandomHex([int]$ByteCount) {
    $bytes = New-Object byte[] $ByteCount
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
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

$lines = @(
    "SITE_HOST=$Hostname"
    "SITE_ADDRESS=$Hostname"
    "SITE_ORIGIN=https://$Hostname"
    "DEPLOY_TRANSPORT=tunnel"
    "TUNNEL_TOKEN=$tunnelToken"
    "NODE_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-alpine"
    "PYTHON_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/python:3.13-slim"
    "POSTGRES_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/postgres:16-alpine"
    "CADDY_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/caddy:2-alpine"
    "CLOUDFLARED_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/cloudflare/cloudflared:latest"
    "NPM_REGISTRY=https://registry.npmmirror.com"
    "PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/"
    "PIP_TRUSTED_HOST=mirrors.aliyun.com"
    ""
    "POSTGRES_DB=ocean_intelligence"
    "POSTGRES_USER=ocean"
    "POSTGRES_PASSWORD=$(New-RandomHex 32)"
    "ENCRYPTION_KEY=$(New-FernetKey)"
    ""
    "SESSION_COOKIE_SECURE=true"
    "SESSION_TTL_SECONDS=2592000"
    "REALTIME_CACHE_TTL_SECONDS=300"
    "EVENT_TYPE_RECORD_TARGET=100"
    "OCEAN_CODEX_MCP_TOKEN=$(New-RandomHex 32)"
    ""
    "# Required: replace both values with a verified Copernicus Marine account."
    "COPERNICUSMARINE_USERNAME=replace_with_your_copernicus_username_or_email"
    "COPERNICUSMARINE_PASSWORD=replace_with_your_copernicus_password"
    "COPERNICUSMARINE_WAVE_DATASET_ID=cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    "COPERNICUSMARINE_WIND_DATASET_ID=cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H"
    "COPERNICUSMARINE_CURRENT_DATASET_ID=cmems_mod_glo_phy_anfc_merged-uv_PT1H-i"
    "COPERNICUSMARINE_CURRENT_U_VARIABLE=utotal"
    "COPERNICUSMARINE_CURRENT_V_VARIABLE=vtotal"
)

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$parent = Split-Path -Parent $resolvedOutput
[IO.Directory]::CreateDirectory($parent) | Out-Null
[IO.File]::WriteAllText($resolvedOutput, (($lines -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
Write-Output $resolvedOutput
