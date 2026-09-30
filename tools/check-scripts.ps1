# Parse without executing any PowerShell script; node --check likewise never runs JavaScript.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$tools = $PSScriptRoot
foreach ($file in Get-ChildItem -LiteralPath $tools -Filter '*.ps1' -Recurse | Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' }) {
    $parseTokens = $null
    $parseErrors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$parseTokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) {
        throw "PowerShell syntax errors in $($file.FullName): $($parseErrors -join '; ')"
    }
}
foreach ($file in Get-ChildItem -LiteralPath $tools -Filter '*.mjs' -Recurse | Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' }) {
    & node --check $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax errors in $($file.FullName)" }
}
Write-Host 'PowerShell and JavaScript syntax checks passed (no scripts executed).'
