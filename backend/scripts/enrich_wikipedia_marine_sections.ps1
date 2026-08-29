param(
    [string]$Snapshot = "",
    [int]$BatchSize = 20,
    [int]$TimeoutSec = 60,
    [int]$MaxNames = 0,
    [string[]]$Names = @(),
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$backendRoot = Split-Path -Parent $PSScriptRoot
if (-not $Snapshot) {
    $Snapshot = Join-Path $backendRoot "app\data\wikipedia_marine_zh.json"
}
if (-not (Test-Path -LiteralPath $Snapshot)) { throw "Wikipedia snapshot not found: $Snapshot" }

function Invoke-WithRetry([string]$Uri, [int]$Attempts = 5) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            return Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec $TimeoutSec -Headers @{
                "User-Agent" = "OceanIntelligence/1.0 (versioned marine encyclopedia snapshot)"
            }
        } catch {
            if ($attempt -eq $Attempts) { throw }
            Start-Sleep -Seconds (3 * $attempt)
        }
    }
}

function Invoke-WikipediaQuery([hashtable]$Parameters, [int]$Attempts = 5) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            return Invoke-RestMethod -Uri "https://en.wikipedia.org/w/api.php" -Method Post -Body $Parameters -TimeoutSec $TimeoutSec -Headers @{
                "User-Agent" = "OceanIntelligence/1.0 (versioned marine encyclopedia snapshot)"
            }
        } catch {
            if ($attempt -eq $Attempts) { throw }
            Start-Sleep -Seconds (3 * $attempt)
        }
    }
}

function Convert-ToWords([string]$Value) {
    return @(($Value.ToLowerInvariant() -replace '[^a-z0-9]+', ' ').Trim() -split '\s+' | Where-Object { $_ })
}

function Test-SpecificSectionMatch([string]$Requested, [string]$Fragment) {
    $requestedWords = @(Convert-ToWords $Requested)
    $fragmentWords = @(Convert-ToWords $Fragment)
    if (-not $requestedWords.Count -or -not $fragmentWords.Count) { return $false }
    $directions = @('north', 'northern', 'south', 'southern', 'east', 'eastern', 'west', 'western', 'northeast', 'northwest', 'southeast', 'southwest', 'central', 'inner', 'outer', 'upper', 'lower')
    foreach ($direction in $directions) {
        if ($requestedWords -contains $direction -and -not ($fragmentWords -contains $direction)) { return $false }
    }
    $generic = @('the', 'of', 'ocean', 'sea', 'gulf', 'bay', 'strait', 'channel', 'passage', 'fjord', 'basin', 'shelf', 'coast', 'waters', 'area', 'region')
    $subjectWords = @($requestedWords | Where-Object { $generic -notcontains $_ })
    if (-not $subjectWords.Count) { return $false }
    $matches = @($subjectWords | Where-Object { $fragmentWords -contains $_ }).Count
    return (($matches / $subjectWords.Count) -ge 0.6)
}

function Convert-HtmlParagraphs([string]$Html) {
    $clean = [regex]::Replace($Html, '<(?:table|style|script)[^>]*>.*?</(?:table|style|script)>', '', 'Singleline,IgnoreCase')
    $clean = [regex]::Replace($clean, '<sup[^>]*(?:reference|cite_ref)[^>]*>.*?</sup>', '', 'Singleline,IgnoreCase')
    $clean = [regex]::Replace($clean, '<sup[^>]*>(.*?)</sup>', '^$1', 'Singleline,IgnoreCase')
    $paragraphs = [System.Collections.Generic.List[string]]::new()
    foreach ($match in [regex]::Matches($clean, '<p[^>]*>(.*?)</p>', 'Singleline,IgnoreCase')) {
        $text = [regex]::Replace([string]$match.Groups[1].Value, '<[^>]+>', ' ')
        $text = [System.Net.WebUtility]::HtmlDecode($text)
        $text = ($text -replace '\[\s*[0-9]+\s*\]', '' -replace '\s+', ' ').Trim()
        if ($text.Length -ge 60) { $paragraphs.Add($text) }
    }
    return @($paragraphs)
}

function Invoke-OpenQiTranslationBatch([object[]]$Sources) {
    if (-not $env:OPENAI_API_KEY -or -not $env:OPENAI_BASE_URL) {
        throw "OPENAI_API_KEY and OPENAI_BASE_URL are required for OpenQI translation."
    }
    $items = @($Sources | ForEach-Object {
        [ordered]@{
            id = [string]$_.id
            chinese_name = [string]$_.name
            source_title = [string]$_.source_title
            section = [string]$_.fragment
            paragraphs = @($_.paragraphs)
        }
    })
    $prompt = @"
Translate each English Wikipedia section in INPUT into accurate Simplified Chinese.
Requirements:
1. Translate faithfully. Do not add, infer, summarize, omit, or correct facts.
2. Preserve all numbers, units, dates, proper names, and uncertainty.
3. Use chinese_name for the section subject where appropriate.
4. Keep paragraph order and paragraph boundaries.
5. Return JSON only: {"translations":[{"id":"...","paragraphs":["..."]}]}.
INPUT:
$($items | ConvertTo-Json -Depth 8 -Compress)
"@
    $base = $env:OPENAI_BASE_URL.TrimEnd('/')
    $uri = if ($base.EndsWith('/responses')) { $base } else { "$base/responses" }
    $body = [ordered]@{
        model = "gpt-5.6-sol"
        input = $prompt
        max_output_tokens = 7000
    } | ConvertTo-Json -Depth 6 -Compress
    $headers = @{ Authorization = "Bearer $env:OPENAI_API_KEY" }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 180
            $parts = [System.Collections.Generic.List[string]]::new()
            foreach ($output in @($response.output)) {
                foreach ($content in @($output.content)) {
                    if ($content.text) { $parts.Add([string]$content.text) }
                }
            }
            $text = ($parts -join '').Trim() -replace '^```(?:json)?\s*', '' -replace '\s*```$', ''
            $translations = @(($text | ConvertFrom-Json).translations)
            if ($translations.Count -ne $Sources.Count) { throw "OpenQI returned an incomplete translation batch." }
            return $translations
        } catch {
            if ($attempt -eq 3) { throw }
            Start-Sleep -Seconds (5 * $attempt)
        }
    }
}

$snapshotPayload = Get-Content -LiteralPath $Snapshot -Raw -Encoding UTF8 | ConvertFrom-Json
$catalogueFile = Join-Path ([System.IO.Path]::GetTempPath()) ("marine-atlas-sections-" + [guid]::NewGuid().ToString('N') + ".json")
& python -c "import json,sys; from app.data.marine_atlas import MARINE_ATLAS; open(sys.argv[1], 'w', encoding='utf-8').write(json.dumps([{'name':x['name'],'name_en':x['name_en']} for x in MARINE_ATLAS], ensure_ascii=False))" $catalogueFile
if ($LASTEXITCODE -ne 0) { throw "Unable to read marine atlas." }
$parsedCatalogue = Get-Content -LiteralPath $catalogueFile -Raw -Encoding UTF8 | ConvertFrom-Json
$catalogueList = [System.Collections.Generic.List[object]]::new()
foreach ($entry in $parsedCatalogue) { $catalogueList.Add($entry) }
$catalogue = @($catalogueList)
Remove-Item -LiteralPath $catalogueFile -Force
if ($Names.Count) {
    $requestedNameSet = @{}
    foreach ($requestedName in $Names) { $requestedNameSet[$requestedName.ToLowerInvariant()] = $true }
    $catalogue = @($catalogue | Where-Object {
        $requestedNameSet.ContainsKey(([string]$_.name_en).ToLowerInvariant()) -or
        $requestedNameSet.ContainsKey(([string]$_.name).ToLowerInvariant())
    })
}
if ($MaxNames -gt 0) { $catalogue = @($catalogue | Select-Object -First $MaxNames) }
if (-not $catalogue.Count) { throw "No requested marine atlas names were found." }

$sectionSources = [System.Collections.Generic.List[object]]::new()
$batchCount = [math]::Ceiling($catalogue.Count / $BatchSize)
for ($offset = 0; $offset -lt $catalogue.Count; $offset += $BatchSize) {
    $last = [math]::Min($offset + $BatchSize - 1, $catalogue.Count - 1)
    $batch = @($catalogue[$offset..$last])
    $titles = @($batch | ForEach-Object { [string]$_.name_en })
    $payload = Invoke-WikipediaQuery @{
        action = "query"
        format = "json"
        formatversion = "2"
        prop = "info"
        inprop = "url"
        redirects = "1"
        origin = "*"
        titles = ($titles -join '|')
    }
    $normalized = @{}
    foreach ($item in @($payload.query.normalized)) { $normalized[[string]$item.from] = [string]$item.to }
    $redirects = @{}
    foreach ($item in @($payload.query.redirects)) {
        if ($item.from -and $item.to -and $item.tofragment) { $redirects[[string]$item.from] = $item }
    }
    $pages = @{}
    foreach ($page in @($payload.query.pages)) { $pages[[string]$page.title] = $page }
    foreach ($entry in $batch) {
        $requested = [string]$entry.name_en
        $normalisedRequested = if ($normalized.ContainsKey($requested)) { $normalized[$requested] } else { $requested }
        $redirect = if ($redirects.ContainsKey($normalisedRequested)) { $redirects[$normalisedRequested] } elseif ($redirects.ContainsKey($requested)) { $redirects[$requested] } else { $null }
        if (-not $redirect -or -not (Test-SpecificSectionMatch $requested ([string]$redirect.tofragment))) { continue }
        $page = $pages[[string]$redirect.to]
        if (-not $page) { continue }
        $sectionsUri = "https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=sections&origin=*&page=$([uri]::EscapeDataString([string]$redirect.to))"
        $sectionsPayload = Invoke-WithRetry $sectionsUri
        $fragmentKey = (([string]$redirect.tofragment).ToLowerInvariant() -replace '[^a-z0-9]+', '')
        $section = @($sectionsPayload.parse.sections | Where-Object {
            (([string]$_.anchor).ToLowerInvariant() -replace '[^a-z0-9]+', '') -eq $fragmentKey -or
            (([string]$_.line).ToLowerInvariant() -replace '[^a-z0-9]+', '') -eq $fragmentKey
        }) | Select-Object -First 1
        if (-not $section) { continue }
        $sectionUri = "https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&origin=*&page=$([uri]::EscapeDataString([string]$redirect.to))&section=$([uri]::EscapeDataString([string]$section.index))"
        $sectionPayload = Invoke-WithRetry $sectionUri
        $paragraphs = @(Convert-HtmlParagraphs ([string]$sectionPayload.parse.text))
        if (-not $paragraphs.Count) { continue }
        $sectionSources.Add([ordered]@{
            id = "$($page.pageid):$($section.index)"
            name = [string]$entry.name
            name_en = $requested
            page = $page
            fragment = [string]$redirect.tofragment
            section_index = [string]$section.index
            source_title = "$([string]$redirect.to)#$([string]$redirect.tofragment)"
            paragraphs = $paragraphs
        })
    }
    Write-Host "Section scan $([math]::Floor($offset / $BatchSize) + 1)/$batchCount`: $($sectionSources.Count) exact section redirects"
    Start-Sleep -Seconds 2
}

Write-Host "Exact section redirects ready: $($sectionSources.Count)"
if ($DryRun) {
    $sectionSources | Select-Object name,name_en,source_title,@{n='paragraphs';e={$_.paragraphs.Count}} | Format-Table -AutoSize
    exit 0
}
if (-not $sectionSources.Count) { exit 0 }

$newArticles = [System.Collections.Generic.List[object]]::new()
$translationBatchSize = 4
for ($offset = 0; $offset -lt $sectionSources.Count; $offset += $translationBatchSize) {
    $last = [math]::Min($offset + $translationBatchSize - 1, $sectionSources.Count - 1)
    $sources = @($sectionSources[$offset..$last])
    $translations = @(Invoke-OpenQiTranslationBatch $sources)
    $byId = @{}
    foreach ($translation in $translations) { $byId[[string]$translation.id] = $translation }
    foreach ($source in $sources) {
        $translated = $byId[[string]$source.id]
        $paragraphs = @($translated.paragraphs | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
        if (-not $paragraphs.Count) { throw "Empty section translation for $($source.name_en)." }
        $anchor = [uri]::EscapeDataString([string]$source.fragment).Replace('%20', '_')
        $newArticles.Add([ordered]@{
            page_id = [int64]$source.page.pageid
            revision_id = [int64]$source.page.lastrevid
            title = [string]$source.name
            source_title = [string]$source.source_title
            language = "zh"
            original_language = "en"
            content_scope = "translated_section"
            translation_method = "openqi:gpt-5.6-sol"
            source_name = "English Wikipedia section / OpenQI GPT-5.6-Sol Chinese translation"
            url = "$([string]$source.page.canonicalurl)#$anchor"
            page_updated_at = [string]$source.page.touched
            extract = ($paragraphs -join "`n`n")
            paragraphs = $paragraphs
            original_extract = (@($source.paragraphs) -join "`n`n")
            aliases = @([string]$source.name, [string]$source.name_en)
        })
    }
}

$replacementAliases = @{}
foreach ($article in $newArticles) { foreach ($alias in @($article.aliases)) { $replacementAliases[[string]$alias] = $true } }
$keptArticles = [System.Collections.Generic.List[object]]::new()
foreach ($article in @($snapshotPayload.articles)) {
    if ($article.content_scope -eq 'translated_section' -and $replacementAliases.ContainsKey([string]$article.title)) { continue }
    $article.aliases = @($article.aliases | Where-Object { -not $replacementAliases.ContainsKey([string]$_) })
    $keptArticles.Add($article)
}
$snapshotPayload.articles = @(@($keptArticles) + @($newArticles) | Sort-Object title,source_title)
$snapshotPayload.metadata | Add-Member -NotePropertyName section_article_count -NotePropertyValue $newArticles.Count -Force
$snapshotPayload.metadata | Add-Member -NotePropertyName section_generated_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString('o')) -Force
$snapshotPayload.metadata | Add-Member -NotePropertyName section_translation_method -NotePropertyValue "openqi:gpt-5.6-sol" -Force
$snapshotPayload.metadata.verified_article_count = $snapshotPayload.articles.Count
$json = $snapshotPayload | ConvertTo-Json -Depth 14
[System.IO.File]::WriteAllText($Snapshot, $json + "`n", [System.Text.UTF8Encoding]::new($false))
& python "$PSScriptRoot\normalize_wikipedia_marine_snapshot.py" --snapshot $Snapshot --write
if ($LASTEXITCODE -ne 0) { throw "Wikipedia snapshot normalization failed." }
Write-Host "Saved $($newArticles.Count) exact translated Wikipedia sections. Total articles: $($snapshotPayload.articles.Count)"
