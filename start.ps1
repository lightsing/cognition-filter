[CmdletBinding()]
param([switch]$NoBuild)

$ErrorActionPreference = 'Stop'
$manifest = Join-Path $PSScriptRoot 'Cargo.toml'
$binary = $null

if (!$NoBuild -and (Test-Path -LiteralPath $manifest) -and (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $binary = & (Join-Path $PSScriptRoot 'build.ps1')
} else {
    $binary = @('cognition-filter.exe', 'dist/release/cognition-filter.exe', 'dist/dev/cognition-filter.exe', 'target/release/cognition-filter.exe', 'target/debug/cognition-filter.exe', 'dist/cognition-filter.exe') |
        ForEach-Object { Join-Path $PSScriptRoot $_ } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
}

if (!$binary -or !(Test-Path -LiteralPath $binary -PathType Leaf)) {
    throw 'Could not find cognition-filter.exe. Install Rust and run .\start.ps1, or place the compiled executable next to this script.'
}

& $binary
exit $LASTEXITCODE
