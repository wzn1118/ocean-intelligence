param(
    [string]$PptxPath = 'E:\Ocean-Intelligence\output\ppt\ocean-intelligence-promo\Ocean-Intelligence-Promo-CN.pptx'
)

$ErrorActionPreference = 'Stop'
$resolvedPptx = (Resolve-Path -LiteralPath $PptxPath).Path
$outputDir = Split-Path -Parent $resolvedPptx
$baseName = [IO.Path]::GetFileNameWithoutExtension($resolvedPptx)
$pdfPath = Join-Path $outputDir ($baseName + '.pdf')
$slidesDir = Join-Path $outputDir ($baseName + '-slides')
New-Item -ItemType Directory -Force -Path $slidesDir | Out-Null

$powerPoint = $null
$presentation = $null
try {
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $powerPoint.Visible = 1
    $presentation = $powerPoint.Presentations.Open($resolvedPptx, $false, $false, $false)
    $presentation.SaveAs($pdfPath, 32)
    $presentation.Export($slidesDir, 'PNG', 1600, 900)
    Write-Output "PDF=$pdfPath"
    Write-Output "SLIDES=$slidesDir"
}
finally {
    if ($presentation) {
        $presentation.Close()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation)
    }
    if ($powerPoint) {
        $powerPoint.Quit()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
