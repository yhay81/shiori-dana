[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WorkerPath = Join-Path $RepoRoot "src\worker.tsx"
$MigrationPath = Join-Path $RepoRoot "migrations\0001_events.sql"
$AppPath = Join-Path $RepoRoot "public\app.js"
$ServiceWorkerPath = Join-Path $RepoRoot "public\sw.js"
$StylesPath = Join-Path $RepoRoot "public\styles.css"
$PublicDirectory = Join-Path $RepoRoot "public"

$RequiredFiles = @(
    ".github\workflows\ci.yml",
    "DECISIONS.md",
    "EXPERIMENT.md",
    "METRICS.md",
    "PRIVACY.md",
    "README.md",
    "SECURITY.md",
    "STACK.md",
    "ops\product-metrics.ps1",
    "ops\product-metrics.sql",
    "ops\submit-indexnow.ps1",
    "public\app.js",
    "public\favicon.svg",
    "public\manifest.webmanifest",
    "public\styles.css",
    "public\og.svg",
    "public\robots.txt",
    "public\sitemap.xml",
    "public\sw.js"
)
foreach ($RelativePath in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $RelativePath))) {
        throw "Missing required release file: $RelativePath"
    }
}

$Worker = Get-Content -Raw -LiteralPath $WorkerPath
$Migration = Get-Content -Raw -LiteralPath $MigrationPath
$App = Get-Content -Raw -LiteralPath $AppPath
$ServiceWorker = Get-Content -Raw -LiteralPath $ServiceWorkerPath
$Styles = Get-Content -Raw -LiteralPath $StylesPath
$ProductSurface = @($Worker, $App) -join "`n"

foreach ($VisualClass in @(
    'class="shelf-scene"',
    'class="scene-shelf"',
    'class="open-book"',
    'class="book-shelf"',
    'class="shelf-summary"',
    'class="reading-calendar"',
    'class="empty-books"'
)) {
    if (-not $Worker.Contains($VisualClass)) {
        throw "Missing product visual: $VisualClass"
    }
}
if ($ProductSurface -match '(?i)public validation|success criteria|experiment|仮説|成功条件|市場スコア|移行候補|収益性') {
    throw "Research copy must not appear on the product surface"
}
if ($Styles -match '(?s)h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px' -or
    -not $Styles.Contains("clamp(1.75rem, 3.2vw, 2rem)")) {
    throw "Primary heading must remain at or below 32px"
}
if ($App -match '(?i)innerHTML|eval\(|new Function') {
    throw "Reading content must not be interpreted as markup or code"
}
if (([regex]::Matches($App, '(?i)\bfetch\s*\(').Count -ne 2) -or
    -not $App.Contains('fetch("/api/events"') -or
    -not $App.Contains('fetch("/api/books/search"')) {
    throw "The browser may call only the local search proxy and anonymous event endpoint"
}
if (-not $App.Contains("indexedDB.open") -or
    -not $App.Contains('createObjectStore("books"') -or
    -not $App.Contains('createObjectStore("logs"') -or
    -not $App.Contains('createObjectStore("config"') -or
    -not $App.Contains("const maximumBooks = 500") -or
    -not $App.Contains("const maximumLogs = 5000")) {
    throw "Expected bounded local book, reading log, and configuration storage"
}
if (-not $App.Contains(".shiori") -or
    -not $App.Contains("text/csv") -or
    -not $App.Contains('toBlob((blob)') -or
    -not $App.Contains("formulaSafe") -or
    -not $App.Contains("hasOnlyKeys") -or
    -not $App.Contains('project.format !== "shiori-dana"')) {
    throw "Expected strict import and privacy-safe share/export paths"
}
if (-not $ProductSurface.Contains("書名やメモは入れず") -or
    -not $ProductSurface.Contains("書名・ISBN・頁数・メモは送りません")) {
    throw "Expected privacy-safe defaults on the product surface"
}
if (-not $ServiceWorker.Contains('const cacheName = "shiori-dana-v1"') -or
    -not $ServiceWorker.Contains("caches.open") -or
    -not $ServiceWorker.Contains("fetch(event.request)") -or
    -not $ServiceWorker.Contains('!event.request.url.includes("/api/")')) {
    throw "Expected a network-first asset cache that excludes APIs"
}
if (-not $Worker.Contains("45 * 86400") -or
    -not $Worker.Contains("DELETE FROM product_events WHERE created_at <= ?") -or
    ([regex]::Matches($Worker, 'app\.(?:post|put|patch|delete)\("/api/').Count -ne 2) -or
    ([regex]::Matches($Worker, 'INSERT INTO product_events').Count -ne 1)) {
    throw "Expected one telemetry write plus one content-free search proxy"
}
if (-not $Worker.Contains('new URLSearchParams({ cnt: "12" })') -or
    -not $Worker.Contains('candidate.hostname === "ndlsearch.ndl.go.jp"') -or
    $Worker.Contains("c.env.DB.prepare(`INSERT") -and $Worker.Contains("query,")) {
    throw "Expected bounded NDL search and safe result links without query persistence"
}
if ($Migration -match '(?i)\b(title|author|isbn|publisher|page|memo|tag|filename|email|phone|user_agent|ip_address|query)\b') {
    throw "Reading content, identity, query, and file metadata do not belong in telemetry"
}
foreach ($EventName in @(
    "visited",
    "book_searched",
    "book_added",
    "progress_updated",
    "book_finished",
    "review_opened",
    "share_card_saved",
    "csv_exported",
    "project_exported",
    "project_imported",
    "returned"
)) {
    if (-not $Migration.Contains("'$EventName'") -or -not $Worker.Contains("""$EventName""")) {
        throw "Event contract is missing: $EventName"
    }
}
if (-not $Migration.Contains("is_qa") -or
    -not $Migration.Contains("CHECK(name IN") -or
    -not $Worker.Contains('Object.keys(body).length !== 1')) {
    throw "Expected allowlisted exact-shape events and a QA boundary"
}
if ($Worker -match '(?i)better-auth|betterAuth') {
    throw "Account authentication is not needed for this local-first release"
}
if (-not $Worker.Contains("camera=(), geolocation=(), microphone=(), payment=()") -or
    $ProductSurface -match 'navigator\.geolocation|getCurrentPosition|watchPosition|Notification\.requestPermission') {
    throw "The release must not request sensitive permissions"
}
if (-not $Styles.Contains("@media print")) {
    throw "Expected a readable print layout"
}

$OgPath = Join-Path $PublicDirectory "og.svg"
if ((Get-Item -LiteralPath $OgPath).Length -lt 2500) {
    throw "Expected a product-specific OG SVG larger than 2.5 KB"
}

$KeyFiles = @(
    Get-ChildItem -LiteralPath $PublicDirectory -File |
        Where-Object { $_.Name -match "^[a-zA-Z0-9-]{8,128}\.txt$" }
)
if ($KeyFiles.Count -ne 1) {
    throw "Expected exactly one generated IndexNow key file, found $($KeyFiles.Count)"
}
$Key = (Get-Content -Raw -LiteralPath $KeyFiles[0].FullName).Trim()
if ($Key -ne $KeyFiles[0].BaseName) {
    throw "IndexNow key file name and content do not match"
}

Write-Output "Product release contract is satisfied"
