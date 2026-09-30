<#
.SYNOPSIS
  Verifies the frozen 0.159.2 source or builds an explicitly selected engine mode on Windows x64.

.DESCRIPTION
  -BaselineOnly -VerifyOnly checks the pinned SHA and clean state without Rust or patches.
  -BaselineOnly without -VerifyOnly builds stock upstream; it requires an existing -EnginePath.
  -CombinedPatch is reserved for 0.159.2 and rejects execution until #29/#30 finish migration.
  -RoutingPatch is the historical 0.158 single routing patch mode. The default remains the
  historical 0.154 patch mode. Historical modes reject new source and may clone under -WorkDir.
  Existing checkouts are never switched or reset. No Microsoft Store client files are modified.

.PARAMETER EnginePath
  Existing checkout at the selected mode's exact SHA. Required for the new stable baseline.
.PARAMETER WorkDir
  Clone destination for historical modes only.
.PARAMETER Profile
  Cargo profile (release or debug); default release preserves historical installer behavior.
  This round uses -VerifyOnly, then a single combined debug build in #31/#16.
.PARAMETER BaselineOnly
  Select frozen 0.159.2 source without any patches.
.PARAMETER VerifyOnly
  With -BaselineOnly, verify source and return before any Rust checks or build.
.PARAMETER RoutingPatch
  Historical 0.158 routing and session-binding patch (#8/#9), not the full combination.
.PARAMETER CombinedPatch
  New 0.159.2 combined installation entry, blocked until patch migration is complete.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File install-engine.ps1 -BaselineOnly -VerifyOnly -EnginePath E:\Projects\codex
#>
param(
    [string]$EnginePath,
    [string]$WorkDir,
    [ValidateSet('release', 'debug')]
    [string]$Profile = 'release',
    [switch]$BaselineOnly,
    [switch]$RoutingPatch,
    [switch]$CombinedPatch,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Historical patch pins stay separate from the current machine-readable release baseline.
# Every mode verifies the exact source before modifying the checkout.
$LegacyPatchSha = '1715e55076737158ba61d43158ede504de6d4ce1'
$HistoricalRoutingSha = '064c6b8c737f5b41d171fdda80bd9ef10ad06eb3'
$Baseline = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\config\engine-baseline.json') | ConvertFrom-Json
if (@($BaselineOnly, $RoutingPatch, $CombinedPatch).Where({ $_ }).Count -gt 1) {
    throw '-BaselineOnly, -RoutingPatch and -CombinedPatch cannot be combined.'
}
if ($CombinedPatch) {
    throw 'The 0.159.2 combined patches are not migrated yet (#29/#30). No old 0.158 or 0.154 patch will be applied. Use -BaselineOnly -VerifyOnly to verify the frozen source.'
}
if ($VerifyOnly -and -not $BaselineOnly) {
    throw '-VerifyOnly requires -BaselineOnly.'
}
if ($BaselineOnly -and (-not $EnginePath -or $WorkDir)) {
    throw '-BaselineOnly requires -EnginePath to the existing checkout; it does not clone another engine or accept -WorkDir.'
}
$PinnedSha = if ($BaselineOnly) { $Baseline.sourceSha } elseif ($RoutingPatch) { $HistoricalRoutingSha } else { $LegacyPatchSha }
$UpstreamUrl = 'https://github.com/openai/codex.git'
$PatchPath = if ($RoutingPatch) {
    Join-Path $PSScriptRoot '..\patch\model-provider-routes-0.158.patch'
} else {
    Join-Path $PSScriptRoot '..\patch\model-provider-routes.patch'
}

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor Green
}

function Write-Note {
    param([string]$Message)
    Write-Host "    $Message"
}

function Test-Tool {
    param([string]$Name, [string]$InstallHint)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "$Name was not found on PATH. $InstallHint"
    }
    Write-Note "$Name -> $($command.Source)"
}

function Invoke-Git {
    param([string[]]$Arguments, [string]$What)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$What failed (git exit code $LASTEXITCODE)."
    }
}

Write-Step 'Checking the tools this script cannot install for you'
Test-Tool -Name 'git' -InstallHint 'Install Git from https://git-scm.com/download/win.'

if (-not $BaselineOnly -and -not (Test-Path -LiteralPath $PatchPath)) {
    throw "patch not found at $PatchPath. Run this script from inside the repository checkout."
}
if ($BaselineOnly) {
    Write-Note "baseline-only: $PinnedSha (the provider patch will not be applied)"
} else {
    Write-Note "patch: $((Resolve-Path -LiteralPath $PatchPath).Path)"
}

if (-not $EnginePath) {
    if (-not $WorkDir) { $WorkDir = Join-Path (Get-Location).Path 'codex-engine' }
    Write-Step "Cloning openai/codex at the pinned commit into $WorkDir"
    if (Test-Path -LiteralPath $WorkDir) {
        throw "$WorkDir already exists. Remove it, or pass -EnginePath to patch an existing checkout."
    }
    # A shallow clone of the default branch keeps the download small; the pinned commit is then
    # fetched by SHA, which is the only way to get a commit that is not at the tip.
    Invoke-Git -What 'git init' -Arguments @('init', '--quiet', $WorkDir)
    Invoke-Git -What 'adding the upstream remote' -Arguments @('-C', $WorkDir, 'remote', 'add', 'origin', $UpstreamUrl)
    Invoke-Git -What 'fetching the pinned commit' -Arguments @('-C', $WorkDir, 'fetch', '--depth', '1', 'origin', $PinnedSha)
    Invoke-Git -What 'checking out the pinned commit' -Arguments @('-C', $WorkDir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD')
    $EnginePath = (Resolve-Path -LiteralPath $WorkDir).Path
} else {
    $EnginePath = (Resolve-Path -LiteralPath $EnginePath).Path
    Write-Step "Using the existing checkout at $EnginePath"
}

Write-Step 'Verifying the checkout is the commit the patch expects'
$headOutput = Invoke-Git -What 'reading HEAD' -Arguments @('-C', $EnginePath, 'rev-parse', 'HEAD')
$actualSha = ($headOutput -join "`n").Trim()
if ($actualSha -ne $PinnedSha) {
    throw "checked out $actualSha but this build needs $PinnedSha. Use a clean checkout at the pinned commit."
}
Write-Ok "HEAD is $PinnedSha"

$dirty = @(Invoke-Git -What 'checking source status' -Arguments @('-C', $EnginePath, 'status', '--porcelain'))
if ($dirty.Count -gt 0) {
    throw 'the checkout has uncommitted changes. Commit or discard them first, so this script cannot overwrite your work.'
}
Write-Ok 'the checkout is clean'

if (-not (Test-Path -LiteralPath (Join-Path $EnginePath 'codex-rs\Cargo.toml'))) {
    throw "$EnginePath does not look like the Codex repository (codex-rs\Cargo.toml is missing)."
}
if ($VerifyOnly) {
    Write-Ok "Verified without patching or compiling: $($Baseline.tag), $PinnedSha, $($Baseline.platform)."
    return
}

Test-Tool -Name 'cargo' -InstallHint 'Install Rust from https://rustup.rs, then reopen this shell so PATH is refreshed.'
Test-Tool -Name 'rustc' -InstallHint 'Install Rust from https://rustup.rs, then reopen this shell so PATH is refreshed.'
$rustcVerbose = ((& rustc -vV) 2>&1) -join "`n"
$hostTriple = [regex]::Match($rustcVerbose, '(?m)^host:\s*(.+)$').Groups[1].Value.Trim()
if ($LASTEXITCODE -ne 0 -or $hostTriple -ne 'x86_64-pc-windows-msvc') {
    throw "this delivery requires the Windows x64 MSVC toolchain, found '$hostTriple'. Install it with: rustup default stable-msvc"
}

if ($BaselineOnly) {
    Write-Step 'Building the unpatched stable baseline'
} else {
    Write-Step 'Applying the patch'
    # --check first, so a mismatch is reported before anything is touched. git talks progress on stderr,
    # which PowerShell renders as an error block; capture both streams and only surface them on failure.
    $checkOutput = & git -C $EnginePath apply --check $PatchPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        $checkOutput | ForEach-Object { Write-Host "    $_" }
        throw 'the patch does not apply to this checkout. Nothing was modified.'
    }
    Invoke-Git -What 'applying the patch' -Arguments @('-C', $EnginePath, 'apply', $PatchPath)
    Write-Ok "$(@(& git -C $EnginePath status --porcelain).Count) files patched"
}

Write-Step "Building the engine (-p codex-cli --bin codex, profile $Profile)"
Write-Note 'the first build downloads and compiles the CLI and its dependencies and takes a while'
$cargoArguments = @('build', '-p', 'codex-cli', '--bin', 'codex')
if ($Profile -eq 'release') { $cargoArguments += '--release' }
# The release tag's workspace version can differ from the checked-in lockfile's local package
# versions. Cargo updates that lockfile while building; baseline verification must leave the
# previously clean upstream checkout exactly as it found it.
$baselineLockPath = Join-Path $EnginePath 'codex-rs\Cargo.lock'
$baselineLockBytes = if ($BaselineOnly) { [System.IO.File]::ReadAllBytes($baselineLockPath) } else { $null }
Push-Location (Join-Path $EnginePath 'codex-rs')
try {
    & cargo @cargoArguments
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build failed (exit code $LASTEXITCODE). Rerun cargo in $EnginePath\codex-rs to see the full error."
    }
}
finally {
    Pop-Location
    if ($BaselineOnly) {
        [System.IO.File]::WriteAllBytes($baselineLockPath, $baselineLockBytes)
    }
}

$engineBinary = Join-Path $EnginePath "codex-rs\target\$Profile\codex.exe"
if (-not (Test-Path -LiteralPath $engineBinary)) {
    throw "the build reported success but $engineBinary is missing."
}
$sizeMb = [math]::Round((Get-Item -LiteralPath $engineBinary).Length / 1MB, 1)

Write-Step 'Done'
Write-Ok "engine: $engineBinary ($sizeMb MB)"
if ($BaselineOnly) {
    Write-Note 'This is the unpatched upstream engine for baseline validation only.'
    return
}
if ($RoutingPatch) {
    Write-Note 'This engine contains model-provider routing and session binding; legacy proxy and agent additions are not included.'
    Write-Note 'Configure model_providers and model_provider_routes in an isolated CODEX_HOME to try it.'
    return
}
Write-Host ''
Write-Host 'Next steps (all of them are in README.md):' -ForegroundColor Cyan
Write-Host "  1. Point the client at it:        `$env:CODEX_CLI_PATH = '$engineBinary'"
Write-Host '  2. Store the provider key once:   tools\set-provider-key.ps1'
Write-Host '  3. Merge the model catalogs:      tools\merge-model-catalogs.mjs  (needs Node.js)'
Write-Host '  4. Add the provider blocks to %USERPROFILE%\.codex\config.toml (config\example.config-snippet.toml)'
Write-Host '  5. Start the desktop client through tools\start-desktop-deepseek.ps1'
