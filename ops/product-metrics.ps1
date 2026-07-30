[CmdletBinding()]
param(
    [switch]$Local
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SqlPath = Join-Path $PSScriptRoot "product-metrics.sql"
$Wrangler = Join-Path $RepoRoot "node_modules\.bin\wrangler.cmd"
$Target = if ($Local) { "--local" } else { "--remote" }
$Sql = (Get-Content $SqlPath) -join " "

$Output = & $Wrangler d1 execute shiori-dana $Target --json --command $Sql
if ($LASTEXITCODE -ne 0) {
    throw "D1 metrics query failed with exit code $LASTEXITCODE"
}

$Payload = ($Output -join [Environment]::NewLine) | ConvertFrom-Json
$Row = $Payload[0].results[0]
if (-not $Row) {
    throw "D1 metrics query returned no result"
}

function Get-Percent {
    param([int]$Numerator, [int]$Denominator)
    if ($Denominator -eq 0) { return $null }
    return [Math]::Round(($Numerator / $Denominator) * 100, 1)
}

$Users = [int]$Row.users
$Adders = [int]$Row.book_adders
$Updaters = [int]$Row.progress_updaters
$CarryUsers = [Math]::Max(
    [int]$Row.reviewers,
    [Math]::Max(
        [int]$Row.share_card_users,
        [Math]::Max([int]$Row.csv_exporters, [int]$Row.project_exporters)
    )
)

[ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    service = "shiori-dana"
    environment = if ($Local) { "local" } else { "production" }
    funnel = [ordered]@{
        users = $Users
        searchers = [int]$Row.searchers
        book_adders = $Adders
        progress_updaters = $Updaters
        finishers = [int]$Row.finishers
        reviewers = [int]$Row.reviewers
        share_card_users = [int]$Row.share_card_users
        csv_exporters = [int]$Row.csv_exporters
        project_exporters = [int]$Row.project_exporters
        importers = [int]$Row.importers
        returned = [int]$Row.returned
        progress_updaters_7d = [int]$Row.progress_updaters_7d
        five_book_users = [int]$Row.five_book_users
        three_day_readers = [int]$Row.three_day_readers
        readers_spanning_7d = [int]$Row.readers_spanning_7d
        three_update_readers = [int]$Row.three_update_readers
    }
    rates = [ordered]@{
        add_percent = Get-Percent $Adders $Users
        progress_percent = Get-Percent $Updaters $Adders
        five_book_percent = Get-Percent ([int]$Row.five_book_users) $Adders
        three_day_percent = Get-Percent ([int]$Row.three_day_readers) $Updaters
        carry_percent = Get-Percent $CarryUsers $Updaters
    }
} | ConvertTo-Json -Depth 4
