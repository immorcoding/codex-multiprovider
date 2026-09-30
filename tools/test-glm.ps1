<#
.SYNOPSIS
  Reusable Windows GLM acceptance. Default: local mocks, no key and no model charges.
.EXAMPLE
  ./tools/test-glm.ps1 -Service coding-plan -Cases text-low
.EXAMPLE
  ./tools/test-glm.ps1 -Service coding-plan -Live -ConfirmLive -Cases text-low -MaxRequests 1
.EXAMPLE
  ./tools/test-glm.ps1 -Service payg -Live -ConfirmLive -ResponsesQualified -BaseUrl https://api.z.ai/api/v1 -Cases text-low -MaxRequests 1
#>
param(
    [ValidateSet('coding-plan', 'payg')][string]$Service = 'coding-plan',
    [switch]$Live,
    [switch]$ConfirmLive,
    [switch]$ResponsesQualified,
    [string]$BaseUrl,
    [string]$Cases,
    [int]$MaxRequests,
    [int]$TimeoutMs,
    [string]$EnginePath,
    [string]$PythonPath,
    [string]$MockScenario
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$profiles = Get-Content -LiteralPath (Join-Path $repository 'config/glm-acceptance-profiles.json') -Raw | ConvertFrom-Json
$keyName = $profiles.$Service.keyEnv
$arguments = @((Join-Path $PSScriptRoot 'glm-acceptance/run.mjs'), '--profile', $Service)
if ($Live) { $arguments += '--live' }
if ($ConfirmLive) { $arguments += '--confirm-live' }
if ($ResponsesQualified) { $arguments += '--responses-qualified' }
foreach ($entry in @(
    @('BaseUrl', '--base-url', $BaseUrl), @('Cases', '--cases', $Cases),
    @('MaxRequests', '--max-requests', $MaxRequests), @('TimeoutMs', '--timeout-ms', $TimeoutMs),
    @('EnginePath', '--engine', $EnginePath), @('PythonPath', '--python', $PythonPath),
    @('MockScenario', '--mock-scenario', $MockScenario)
)) {
    if ($PSBoundParameters.ContainsKey($entry[0])) { $arguments += @($entry[1], [string]$entry[2]) }
}
$temporaryKey = $false
$exitCode = 2
try {
    # Do not prompt before the basic explicit authorization/qualification/budget gates.
    if ($Live -and $ConfirmLive -and $MaxRequests -gt 0 -and
        ($Service -ne 'payg' -or ($ResponsesQualified -and $BaseUrl)) -and
        -not [Environment]::GetEnvironmentVariable($keyName, 'Process')) {
        $secureKey = Read-Host ('Enter the ' + $Service + ' API key (hidden; process-only)') -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        try {
            [Environment]::SetEnvironmentVariable($keyName, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process')
            $temporaryKey = $true
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
            $secureKey.Dispose()
            Remove-Variable pointer,secureKey
        }
    }
    & node @arguments
    $exitCode = $LASTEXITCODE
} finally {
    if ($temporaryKey) { [Environment]::SetEnvironmentVariable($keyName, $null, 'Process') }
}
exit $exitCode
