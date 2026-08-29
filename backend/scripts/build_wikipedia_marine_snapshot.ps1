param(
    [string]$Output = "",
    [int]$BatchSize = 20,
    [int]$TimeoutSec = 60,
    [int]$MaxNames = 0
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$backendRoot = Split-Path -Parent $PSScriptRoot
if (-not $Output) {
    $Output = Join-Path $backendRoot "app\data\wikipedia_marine_zh.json"
}

$titleFile = Join-Path ([System.IO.Path]::GetTempPath()) ("marine-atlas-titles-" + [guid]::NewGuid().ToString("N") + ".json")
& python -c "import json,sys; from app.data.marine_atlas import MARINE_ATLAS; open(sys.argv[1], 'w', encoding='utf-8').write(json.dumps(list(dict.fromkeys(str(x['name']).strip() for x in MARINE_ATLAS if str(x.get('name') or '').strip())), ensure_ascii=False))" $titleFile
if ($LASTEXITCODE -ne 0) { throw "Unable to read marine-atlas names." }
$namesJson = Get-Content -LiteralPath $titleFile -Raw -Encoding UTF8
Remove-Item -LiteralPath $titleFile -Force
$parsedNames = $namesJson | ConvertFrom-Json
$names = [System.Collections.Generic.List[string]]::new()
foreach ($parsedName in $parsedNames) { $names.Add([string]$parsedName) }
if ($MaxNames -gt 0 -and $names.Count -gt $MaxNames) {
    $names = [System.Collections.Generic.List[string]]::new([string[]]$names.GetRange(0, $MaxNames))
}
$articlesById = @{}
$missing = [System.Collections.Generic.List[string]]::new()
$batchCount = [math]::Ceiling($names.Count / $BatchSize)

for ($offset = 0; $offset -lt $names.Count; $offset += $BatchSize) {
    $last = [math]::Min($offset + $BatchSize - 1, $names.Count - 1)
    $batch = @($names[$offset..$last])
    $encodedTitles = [uri]::EscapeDataString(($batch -join "|"))
    $uri = "https://zh.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts%7Cinfo&explaintext=1&exintro=1&exsectionformat=plain&inprop=url&redirects=1&converttitles=1&variant=zh-cn&uselang=zh-cn&origin=*&titles=$encodedTitles"
    $payload = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $payload = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec $TimeoutSec
            break
        } catch {
            if ($attempt -eq 3) { throw }
            Start-Sleep -Seconds (15 * $attempt)
        }
    }

    $resolved = @{}
    foreach ($title in $batch) { $resolved[$title] = $title }
    foreach ($item in @($payload.query.normalized)) {
        if ($item.from -and $item.to) { $resolved[[string]$item.from] = [string]$item.to }
    }
    foreach ($item in @($payload.query.redirects)) {
        if (-not $item.from -or -not $item.to) { continue }
        foreach ($original in @($resolved.Keys)) {
            if ($resolved[$original] -eq [string]$item.from) { $resolved[$original] = [string]$item.to }
        }
        $resolved[[string]$item.from] = [string]$item.to
    }
    $pages = @{}
    foreach ($page in @($payload.query.pages)) { $pages[[string]$page.title] = $page }

    foreach ($requested in $batch) {
        $resolvedTitle = [string]$resolved[$requested]
        $page = $pages[$resolvedTitle]
        if (-not $page -or $page.missing -eq $true -or [string]::IsNullOrWhiteSpace([string]$page.extract)) {
            $missing.Add($requested)
            continue
        }
        $pageId = [int64]$page.pageid
        if (-not $articlesById.ContainsKey($pageId)) {
            $paragraphs = [System.Collections.Generic.List[string]]::new()
            foreach ($line in ([string]$page.extract -split "`n")) {
                $value = ($line.Trim() -replace "\s+", " ")
                if ($value.Length -ge 20 -and -not $value.StartsWith("==")) { $paragraphs.Add($value) }
            }
            $articlesById[$pageId] = [ordered]@{
                page_id = $pageId
                revision_id = [int64]$page.lastrevid
                title = [string]$page.title
                language = "zh"
                content_scope = "introduction"
                url = [string]$(if ($page.canonicalurl) { $page.canonicalurl } else { $page.fullurl })
                page_updated_at = [string]$page.touched
                extract = ([string]$page.extract).Trim()
                paragraphs = @($paragraphs)
                aliases = [System.Collections.Generic.List[string]]::new()
            }
        }
        $article = $articlesById[$pageId]
        foreach ($alias in @($requested, $resolvedTitle)) {
            if ($alias -and -not $article.aliases.Contains([string]$alias)) { $article.aliases.Add([string]$alias) }
        }
    }
    $batchNumber = [math]::Floor($offset / $BatchSize) + 1
    Write-Host "Wikipedia batch $batchNumber/$batchCount`: $($articlesById.Count) verified pages"
    Start-Sleep -Milliseconds 1800
}

# Full extracts cannot be batched by MediaWiki. Keep a small, explicit list of
# high-priority articles while the complete atlas still receives verified leads.
$fullTitles = @((-join ([char[]](0x73ED, 0x8FBE, 0x6D77))))
foreach ($fullTitle in $fullTitles) {
    $encodedTitle = [uri]::EscapeDataString($fullTitle)
    $uri = "https://zh.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts%7Cinfo&explaintext=1&exsectionformat=plain&inprop=url&redirects=1&converttitles=1&variant=zh-cn&uselang=zh-cn&origin=*&titles=$encodedTitle"
    $fullPayload = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $fullPayload = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec $TimeoutSec
            break
        } catch {
            if ($attempt -eq 3) { throw }
            Start-Sleep -Seconds (15 * $attempt)
        }
    }
    $page = @($fullPayload.query.pages | Where-Object { $_.missing -ne $true -and -not [string]::IsNullOrWhiteSpace([string]$_.extract) }) | Select-Object -First 1
    if (-not $page) { continue }
    $pageId = [int64]$page.pageid
    if (-not $articlesById.ContainsKey($pageId)) { continue }
    $paragraphs = [System.Collections.Generic.List[string]]::new()
    foreach ($line in ([string]$page.extract -split "`n")) {
        $value = ($line.Trim() -replace "\s+", " ")
        if ($value.Length -ge 20 -and -not $value.StartsWith("==")) { $paragraphs.Add($value) }
    }
    $articlesById[$pageId].extract = ([string]$page.extract).Trim()
    $articlesById[$pageId].paragraphs = @($paragraphs)
    $articlesById[$pageId].revision_id = [int64]$page.lastrevid
    $articlesById[$pageId].page_updated_at = [string]$page.touched
    $articlesById[$pageId].content_scope = "full"
    Write-Host "Saved full article: $fullTitle (revision $($page.lastrevid))"
}

$generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
$payload = [ordered]@{
    metadata = [ordered]@{
        schema_version = 2
        source_name = "维基百科中文资料"
        source_api = "https://zh.wikipedia.org/w/api.php"
        license = "CC BY-SA 4.0 / GFDL; see source page"
        language_variant = "zh-CN"
        generated_at = $generatedAt
        atlas_names_requested = $names.Count
        verified_article_count = $articlesById.Count
        missing_title_count = $missing.Count
        missing_titles = @($missing)
        full_article_titles = $fullTitles
    }
    articles = @($articlesById.Values | Sort-Object title)
}

$parent = Split-Path -Parent $Output
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$json = $payload | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($Output, $json + "`n", [System.Text.UTF8Encoding]::new($false))
& python "$PSScriptRoot\normalize_wikipedia_marine_snapshot.py" --snapshot $Output --write
if ($LASTEXITCODE -ne 0) { throw "Wikipedia snapshot normalization failed." }
Write-Host "Saved $($articlesById.Count) verified pages for $($names.Count) atlas names to $Output"
