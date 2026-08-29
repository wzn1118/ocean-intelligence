param(
    [string]$Snapshot = "",
    [int]$BatchSize = 20,
    [int]$TimeoutSec = 60,
    [int]$MaxNames = 0
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$backendRoot = Split-Path -Parent $PSScriptRoot
if (-not $Snapshot) {
    $Snapshot = Join-Path $backendRoot "app\data\wikipedia_marine_zh.json"
}
if (-not (Test-Path -LiteralPath $Snapshot)) { throw "Chinese Wikipedia snapshot not found: $Snapshot" }

function Invoke-WithRetry([string]$Uri, [int]$Attempts = 3) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            return Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec $TimeoutSec
        } catch {
            if ($attempt -eq $Attempts) { throw }
            Start-Sleep -Seconds (10 * $attempt)
        }
    }
}

function Convert-ToParagraphs([string]$Text) {
    $values = [System.Collections.Generic.List[string]]::new()
    foreach ($line in ($Text -split "`n")) {
        $value = ($line.Trim() -replace "\s+", " ")
        if ($value.Length -ge 20 -and -not $value.StartsWith("==")) { $values.Add($value) }
    }
    return @($values)
}

function Test-SpecificTitleMatch([string]$Requested, [string]$Resolved) {
    $requestedWords = @(($Requested.ToLowerInvariant() -replace '[^a-z0-9]+', ' ').Trim() -split '\s+' | Where-Object { $_ })
    $resolvedWords = @(($Resolved.ToLowerInvariant() -replace '[^a-z0-9]+', ' ').Trim() -split '\s+' | Where-Object { $_ })
    if (($requestedWords -join ' ') -eq ($resolvedWords -join ' ')) { return $true }
    $directionWords = @('north', 'northern', 'south', 'southern', 'east', 'eastern', 'west', 'western', 'northeast', 'northwest', 'southeast', 'southwest', 'central', 'inner', 'outer', 'upper', 'lower')
    foreach ($word in $directionWords) {
        if ($requestedWords -contains $word -and -not ($resolvedWords -contains $word)) { return $false }
    }
    $intersection = @($requestedWords | Where-Object { $resolvedWords -contains $_ }).Count
    $denominator = [math]::Max(1, [math]::Max($requestedWords.Count, $resolvedWords.Count))
    return (($intersection / $denominator) -ge 0.65)
}

function Invoke-OpenQiTranslationBatch([object[]]$Sources) {
    if (-not $env:OPENAI_API_KEY -or -not $env:OPENAI_BASE_URL) {
        throw "OPENAI_API_KEY and OPENAI_BASE_URL are required for OpenQI translation."
    }
    $items = [System.Collections.Generic.List[object]]::new()
    foreach ($source in $Sources) {
        $items.Add([ordered]@{
            id = [string]$source.page.pageid
            chinese_name = [string]$source.display_name
            source_title = [string]$source.page.title
            text = ([string]$source.page.extract).Trim()
        })
    }
    $inputJson = $items | ConvertTo-Json -Depth 5 -Compress
    $prompt = @"
Translate each English Wikipedia marine-geography excerpt in INPUT into accurate Simplified Chinese.
Requirements:
1. Translate faithfully. Do not add, infer, summarize, omit, or correct facts.
2. Preserve all numbers, units, dates, proper names, and uncertainty.
3. Use the supplied chinese_name as the marine region name where it refers to the subject.
4. Return JSON only, with schema: {"translations":[{"id":"...","paragraphs":["..."]}]}.
5. Return exactly one result for every input id and keep paragraph order.
INPUT:
$inputJson
"@
    $base = $env:OPENAI_BASE_URL.TrimEnd('/')
    $uri = if ($base.EndsWith('/responses')) { $base } else { "$base/responses" }
    $headers = @{ Authorization = "Bearer $env:OPENAI_API_KEY" }
    $body = [ordered]@{
        model = "gpt-5.6-sol"
        input = $prompt
        max_output_tokens = 7000
    } | ConvertTo-Json -Depth 6 -Compress

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 180
            $textParts = [System.Collections.Generic.List[string]]::new()
            foreach ($output in @($response.output)) {
                foreach ($content in @($output.content)) {
                    if ($content.text) { $textParts.Add([string]$content.text) }
                }
            }
            $text = ($textParts -join "").Trim()
            $text = $text -replace '^```(?:json)?\s*', '' -replace '\s*```$', ''
            $parsed = $text | ConvertFrom-Json
            $translations = @($parsed.translations)
            if ($translations.Count -ne $Sources.Count) { throw "OpenQI returned $($translations.Count) translations for $($Sources.Count) sources." }
            return $translations
        } catch {
            if ($attempt -eq 3) { throw }
            Start-Sleep -Seconds (5 * $attempt)
        }
    }
}

$snapshotPayload = Get-Content -LiteralPath $Snapshot -Raw -Encoding UTF8 | ConvertFrom-Json
$knownAliases = @{}
foreach ($article in @($snapshotPayload.articles)) {
    foreach ($alias in @($article.title) + @($article.aliases)) {
        if ($alias) { $knownAliases[[string]$alias] = $true }
    }
}

$catalogueFile = Join-Path ([System.IO.Path]::GetTempPath()) ("marine-atlas-pairs-" + [guid]::NewGuid().ToString("N") + ".json")
& python -c "import json,sys; from app.data.marine_atlas import MARINE_ATLAS; rows=[]; seen=set(); [(rows.append({'name':str(x['name']).strip(),'name_en':str(x['name_en']).strip()}) or seen.add((str(x['name']).strip(),str(x['name_en']).strip()))) for x in MARINE_ATLAS if str(x.get('name') or '').strip() and str(x.get('name_en') or '').strip() and (str(x['name']).strip(),str(x['name_en']).strip()) not in seen]; open(sys.argv[1], 'w', encoding='utf-8').write(json.dumps(rows, ensure_ascii=False))" $catalogueFile
if ($LASTEXITCODE -ne 0) { throw "Unable to read marine-atlas pairs." }
$parsedCatalogue = Get-Content -LiteralPath $catalogueFile -Raw -Encoding UTF8 | ConvertFrom-Json
$catalogue = [System.Collections.Generic.List[object]]::new()
foreach ($parsedEntry in $parsedCatalogue) { $catalogue.Add($parsedEntry) }
Remove-Item -LiteralPath $catalogueFile -Force

$candidates = [System.Collections.Generic.List[object]]::new()
foreach ($entry in $catalogue) {
    if (-not $knownAliases.ContainsKey([string]$entry.name) -and -not $knownAliases.ContainsKey([string]$entry.name_en)) {
        $candidates.Add($entry)
    }
}
if ($MaxNames -gt 0 -and $candidates.Count -gt $MaxNames) {
    $candidates = [System.Collections.Generic.List[object]]::new([object[]]$candidates.GetRange(0, $MaxNames))
}

$sourcePages = @{}
$batchCount = [math]::Ceiling($candidates.Count / $BatchSize)
Write-Host "Translation candidates: $($candidates.Count); batches: $batchCount"
for ($offset = 0; $offset -lt $candidates.Count; $offset += $BatchSize) {
    $last = [math]::Min($offset + $BatchSize - 1, $candidates.Count - 1)
    $batch = @($candidates[$offset..$last])
    $requestedTitles = @($batch | ForEach-Object { [string]$_.name_en })
    $encodedTitles = [uri]::EscapeDataString(($requestedTitles -join "|"))
    $uri = "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts%7Cinfo&explaintext=1&exintro=1&inprop=url&redirects=1&origin=*&titles=$encodedTitles"
    if ($uri.Length -gt 7000) { throw "English Wikipedia query is unexpectedly long ($($uri.Length) characters)." }
    $payload = Invoke-WithRetry $uri

    $resolved = @{}
    foreach ($title in $requestedTitles) { $resolved[$title] = $title }
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

    foreach ($entry in $batch) {
        $requested = [string]$entry.name_en
        $resolvedTitle = [string]$resolved[$requested]
        if (-not (Test-SpecificTitleMatch $requested $resolvedTitle)) { continue }
        $page = $pages[$resolvedTitle]
        if (-not $page -or $page.missing -eq $true -or [string]::IsNullOrWhiteSpace([string]$page.extract)) { continue }
        $pageId = [int64]$page.pageid
        if (-not $sourcePages.ContainsKey($pageId)) {
            $sourcePages[$pageId] = [ordered]@{
                page = $page
                aliases = [System.Collections.Generic.List[string]]::new()
                display_name = [string]$entry.name
            }
        }
        foreach ($alias in @([string]$entry.name, [string]$entry.name_en, [string]$resolved[$requested])) {
            if ($alias -and -not $sourcePages[$pageId].aliases.Contains($alias)) { $sourcePages[$pageId].aliases.Add($alias) }
        }
    }
    $batchNumber = [math]::Floor($offset / $BatchSize) + 1
    Write-Host "English Wikipedia batch $batchNumber/$batchCount`: $($sourcePages.Count) source pages"
    Start-Sleep -Milliseconds 1400
}

$translatedArticles = [System.Collections.Generic.List[object]]::new()
$orderedSources = @($sourcePages.Values | Sort-Object { $_.page.title })
$translationBatchSize = 6
$translationBatchCount = [math]::Ceiling($orderedSources.Count / $translationBatchSize)
for ($offset = 0; $offset -lt $orderedSources.Count; $offset += $translationBatchSize) {
    $last = [math]::Min($offset + $translationBatchSize - 1, $orderedSources.Count - 1)
    $sourceBatch = @($orderedSources[$offset..$last])
    $translatedBatch = @(Invoke-OpenQiTranslationBatch $sourceBatch)
    $translationById = @{}
    foreach ($translation in $translatedBatch) { $translationById[[string]$translation.id] = $translation }
    foreach ($source in $sourceBatch) {
        $page = $source.page
        $translation = $translationById[[string]$page.pageid]
        if (-not $translation) { throw "OpenQI omitted page id $($page.pageid)." }
        $paragraphs = @($translation.paragraphs | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
        if (-not $paragraphs.Count) { throw "OpenQI returned an empty translation for page id $($page.pageid)." }
        $translatedArticles.Add([ordered]@{
            page_id = [int64]$page.pageid
            revision_id = [int64]$page.lastrevid
            title = [string]$source.display_name
            source_title = [string]$page.title
            language = "zh"
            original_language = "en"
            content_scope = "translated_introduction"
            translation_method = "openqi:gpt-5.6-sol"
            source_name = "English Wikipedia / OpenQI GPT-5.6-Sol Chinese translation"
            url = [string]$(if ($page.canonicalurl) { $page.canonicalurl } else { $page.fullurl })
            page_updated_at = [string]$page.touched
            extract = ($paragraphs -join "`n`n")
            paragraphs = $paragraphs
            original_extract = ([string]$page.extract).Trim()
            aliases = @($source.aliases)
        })
    }
    $batchNumber = [math]::Floor($offset / $translationBatchSize) + 1
    Write-Host "OpenQI translation batch $batchNumber/$translationBatchCount`: $($translatedArticles.Count)/$($sourcePages.Count) articles"
}

$allArticles = @($snapshotPayload.articles) + @($translatedArticles)
$snapshotPayload.articles = @($allArticles | Sort-Object title)
$snapshotPayload.metadata | Add-Member -NotePropertyName english_pages_matched -NotePropertyValue $sourcePages.Count -Force
$snapshotPayload.metadata | Add-Member -NotePropertyName translated_article_count -NotePropertyValue $translatedArticles.Count -Force
$snapshotPayload.metadata | Add-Member -NotePropertyName translation_generated_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString("o")) -Force
$snapshotPayload.metadata | Add-Member -NotePropertyName translation_method -NotePropertyValue "openqi:gpt-5.6-sol" -Force
$snapshotPayload.metadata.verified_article_count = $snapshotPayload.articles.Count
$json = $snapshotPayload | ConvertTo-Json -Depth 14
[System.IO.File]::WriteAllText($Snapshot, $json + "`n", [System.Text.UTF8Encoding]::new($false))
& python "$PSScriptRoot\normalize_wikipedia_marine_snapshot.py" --snapshot $Snapshot --write
if ($LASTEXITCODE -ne 0) { throw "Wikipedia snapshot normalization failed." }
Write-Host "Saved $($translatedArticles.Count) Chinese translations from $($sourcePages.Count) matched English pages. Total offline articles: $($snapshotPayload.articles.Count)"
