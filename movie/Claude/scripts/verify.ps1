<#
.SYNOPSIS
    Batch-verify result URLs in a single playwright run-code call.
    Replaces __URLS__ placeholder in verify-links.js and executes.
.PARAMETER Urls
    Comma-separated name|url pairs (e.g. "fofo11|https://fofo11.com/dianying/55238,mdvod|https://www.mdvod.com/md/MzZb/")
.PARAMETER UrlsFile
    UTF-8 text file path containing the same comma-separated name|url pairs.
.EXAMPLE
    .\scripts\verify.ps1 -Urls "fofo11|https://fofo11.com/dianying/55238,mdvod|https://www.mdvod.com/md/MzZb/"
.EXAMPLE
    .\scripts\verify.ps1 -UrlsFile "C:\Users\you\.claude\skills\movie\scripts\_verify_urls.txt"
#>
param(
    [Parameter(Mandatory=$true, ParameterSetName='Inline')][string]$Urls,
    [Parameter(Mandatory=$true, ParameterSetName='FromFile')][string]$UrlsFile
)

$ScriptDir = Split-Path -Parent $PSCommandPath
$JsSrc = Join-Path $ScriptDir "verify-links.js"
$JsTmp = Join-Path $ScriptDir "_v.js"
$UrlsPayload = ""

if ($PSCmdlet.ParameterSetName -eq 'FromFile') {
    $UrlsPayload = (Get-Content -Path $UrlsFile -Raw -Encoding UTF8).Trim()
} else {
    $UrlsPayload = ($Urls | ForEach-Object { $_.Trim() })
}

if (-not $UrlsPayload) {
    throw "No URL payload found. Provide -Urls or -UrlsFile with name|url pairs."
}

# Read JS, inject URLs, write temp file
$content = Get-Content $JsSrc -Raw -Encoding UTF8
$content = $content.Replace("var injected = '__URLS__'.trim();", "var injected = '$UrlsPayload'.trim();")
Set-Content -Path $JsTmp -Value $content -Encoding UTF8

Write-Host "=== Verifying $($UrlsPayload.Split(',').Count) URLs ===" -F Cyan

try {
    $result = npx playwright-cli run-code --filename=$JsTmp 2>&1

    # Parse and display result JSON
    $jsonStr = ($result | Where-Object { $_ -match '^\{"verified' }) -join ''
    if ($jsonStr) {
        try {
            $jsonStr | ConvertFrom-Json | ConvertTo-Json -Depth 6
        } catch {
            Write-Warning "JSON 解析失败，以下为原始验证输出："
            $result | ForEach-Object { Write-Host $_ }
        }
    } else {
        Write-Warning "未捕获到结构化 JSON，以下为原始验证输出："
        $result | ForEach-Object { Write-Host $_ }
    }
}
catch {
    Write-Warning "verify.ps1 执行异常：$($_.Exception.Message)"
    if ($result) {
        Write-Warning "以下为原始验证输出："
        $result | ForEach-Object { Write-Host $_ }
    }
    throw
}
finally {
    Remove-Item $JsTmp -Force -ErrorAction SilentlyContinue
}
