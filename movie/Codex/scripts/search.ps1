<#
.SYNOPSIS
    One-shot movie search workflow via playwright-cli.
    Supports summary output and optional verification before close-all.
.PARAMETER Movie
    Movie name to search (e.g. "E.T.外星人")
.PARAMETER Year
    Optional target year for candidate ranking (e.g. 2018)
.PARAMETER Summary
    Output filter-results.js --summary JSON.
.PARAMETER Verify
    Run verify step in the same browser session using summary _verify fields.
.PARAMETER KeepOpen
    Keep browser session open after run (advanced debugging only).
.EXAMPLE
    .\search.ps1 -Movie "盗梦空间" -Year 2010 -Summary -Verify
#>
param(
    [Parameter(Mandatory=$true)][string]$Movie,
    [string]$Year,
    [switch]$Summary,
    [switch]$Verify,
    [switch]$KeepOpen
)

$ScriptDir = Split-Path -Parent $PSCommandPath
$JsSrc = Join-Path $ScriptDir "search-all.js"
$JsTmp = Join-Path $ScriptDir "_run.js"
$RawTmp = Join-Path $ScriptDir "_raw_result.json"
$SummaryTmp = Join-Path $ScriptDir "_summary_result.json"
$VerifyFile = Join-Path $ScriptDir "_verify_urls.txt"
$FilterJs = Join-Path $ScriptDir "filter-results.js"
$VerifyPs1 = Join-Path $ScriptDir "verify.ps1"
$opened = $false
$result = @()

# Read JS, inject movie name, write temp file
$content = Get-Content $JsSrc -Raw -Encoding UTF8
$content = $content.Replace("MOVIE_NAME", $Movie)
Set-Content -Path $JsTmp -Value $content -Encoding UTF8

Write-Host "=== Searching: '$Movie' ===" -ForegroundColor Cyan

try {
    npx playwright-cli open 2>&1 | Out-Null
    $opened = $true
    Start-Sleep -Milliseconds 500

    $result = npx playwright-cli run-code --filename=$JsTmp 2>&1
    $jsonStr = ($result | Where-Object { $_ -match '^\{"movieName' }) -join ''

    if (-not $jsonStr) {
        Write-Warning "未捕获到 search-all.js 结构化 JSON，以下为原始输出："
        $result | ForEach-Object { Write-Host $_ }
        return
    }

    if (-not $Summary -and -not $Verify) {
        $jsonStr | ConvertFrom-Json | ConvertTo-Json -Depth 8
        return
    }

    Set-Content -Path $RawTmp -Value $jsonStr -Encoding UTF8
    $filterArgs = @("--summary", "--input=$RawTmp")
    if ($Year) { $filterArgs += "--year=$Year" }
    $summaryOutput = node $FilterJs @filterArgs
    $summaryJson = ($summaryOutput -join "`n")
    Set-Content -Path $SummaryTmp -Value $summaryJson -Encoding UTF8

    $summaryObj = $null
    try {
        $summaryObj = $summaryJson | ConvertFrom-Json
    } catch {
        Write-Warning "summary JSON 解析失败，以下为原始 summary 输出："
        $summaryOutput | ForEach-Object { Write-Host $_ }
        return
    }

    # Output summary when requested or when Verify is enabled (for transparency).
    if ($Summary -or $Verify) {
        $summaryObj | ConvertTo-Json -Depth 10
    }

    if ($Summary -and -not $Verify) {
        $verifyUrls = [string]$summaryObj._verifyUrls
        if ($verifyUrls) {
            Set-Content -Path $VerifyFile -Value $verifyUrls -Encoding UTF8
            Write-Host "`n=== 浏览器保持打开，可继续执行 verify.ps1 进行批量验证 ===" -ForegroundColor Yellow
            Write-Host "验证命令: & \"$VerifyPs1\" -UrlsFile \"$VerifyFile\"" -ForegroundColor Cyan
        }
    }

    if ($Verify) {
        $recommended = [string]$summaryObj._verifyCmdRecommended
        $verifyUrls = [string]$summaryObj._verifyUrls

        if (-not $recommended -and -not $verifyUrls) {
            Write-Warning "Summary 未提供可验证链接，跳过 verify。"
            return
        }

        if ($recommended -like '-UrlsFile*') {
            if (-not $verifyUrls) {
                Write-Warning "需要 -UrlsFile 方案但 _verifyUrls 为空，跳过 verify。"
                return
            }
            Set-Content -Path $VerifyFile -Value $verifyUrls -Encoding UTF8
            & $VerifyPs1 -UrlsFile $VerifyFile
        } else {
            if ($verifyUrls) {
                & $VerifyPs1 -Urls $verifyUrls
            } else {
                Write-Warning "推荐为 -Urls 方案但 _verifyUrls 为空，跳过 verify。"
            }
        }
    }
}
finally {
    $shouldKeepOpen = $KeepOpen -or ($Summary -and -not $Verify)
    if ($opened -and -not $shouldKeepOpen) {
        npx playwright-cli close-all 2>&1 | Out-Null
    }
    Remove-Item $JsTmp -Force -ErrorAction SilentlyContinue
    Remove-Item $RawTmp -Force -ErrorAction SilentlyContinue
    Remove-Item $SummaryTmp -Force -ErrorAction SilentlyContinue
    if (-not $shouldKeepOpen) { Remove-Item $VerifyFile -Force -ErrorAction SilentlyContinue }
}
