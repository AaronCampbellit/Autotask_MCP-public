[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workRoot = Join-Path $projectRoot 'work'
$runtimeRoot = Join-Path $workRoot 'runtime'
$runtimeModules = Join-Path $runtimeRoot 'node_modules'
$rootModules = Join-Path $projectRoot 'node_modules'
$npmCache = Join-Path $workRoot 'npm-cache'

$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1
$nodeVersionText = & $nodeCommand.Source --version
if ($LASTEXITCODE -ne 0) { throw 'Node version detection failed.' }
$nodeVersion = [version]($nodeVersionText.Trim().TrimStart([char]'v'))
if ($nodeVersion -lt [version]'24.16.0' -or $nodeVersion -ge [version]'25.0.0') {
  throw "Node 24.16.0 or newer within the Node 24 line is required; found $nodeVersion."
}

# Inspect existing module ownership before copying manifests or running npm.
$existingModules = Get-Item -LiteralPath $rootModules -Force -ErrorAction SilentlyContinue
if ($null -ne $existingModules) {
  if ($existingModules.LinkType -ne 'Junction') {
    throw 'The root node_modules is not this project bootstrap junction. It has been left untouched; choose an empty checkout or explicitly relocate your existing installation yourself.'
  }
  $existingTargets = @($existingModules.Target)
  if ($existingTargets.Count -ne 1 -or [string]::IsNullOrWhiteSpace($existingTargets[0])) {
    throw 'The existing node_modules junction target could not be validated. It has been left untouched.'
  }
  $existingTarget = $existingTargets[0]
  if (-not [System.IO.Path]::IsPathRooted($existingTarget)) {
    $existingTarget = Join-Path $projectRoot $existingTarget
  }
  $existingTarget = [System.IO.Path]::GetFullPath($existingTarget).TrimEnd([char]'\')
  if (-not $existingTarget.Equals($runtimeModules.TrimEnd([char]'\'), [StringComparison]::OrdinalIgnoreCase)) {
    throw "The existing node_modules junction points to another installation. It has been left untouched: $existingTarget"
  }
}

foreach ($manifestName in @('package.json', 'package-lock.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $manifestName) -PathType Leaf)) {
    throw "Required root manifest is missing: $manifestName"
  }
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $npmCache -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination (Join-Path $runtimeRoot 'package.json') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Destination (Join-Path $runtimeRoot 'package-lock.json') -Force

Push-Location -LiteralPath $runtimeRoot
try {
  & $npmCommand.Source ci --cache $npmCache --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE. No root module directory was replaced." }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $runtimeModules -PathType Container)) {
  throw 'npm ci did not produce the expected work/runtime/node_modules directory.'
}
if ($null -eq $existingModules) {
  New-Item -ItemType Junction -Path $rootModules -Target $runtimeModules | Out-Null
}

Write-Host 'Dependencies installed from the root lockfile in work/runtime.'
Write-Host 'The root node_modules junction is ready. Run npm run check, npm test, and npm run build.'
