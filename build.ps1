[CmdletBinding()]
param([switch]$Release, [string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$arguments = @('build', '--workspace', '--locked', '--manifest-path', (Join-Path $PSScriptRoot 'Cargo.toml'), '--message-format=json-render-diagnostics')
if ($Release) { $arguments += '--release' }
$libraries = @()
$binary = $null
& cargo @arguments | ForEach-Object {
    $artifact = $_ | ConvertFrom-Json
    if ($artifact.reason -eq 'compiler-artifact') {
        if ($artifact.target.name -eq 'cognition-filter' -and $artifact.executable) {
            $binary = $artifact.executable
        } elseif ($artifact.target.crate_types -contains 'cdylib') {
            $libraries += $artifact.filenames | Where-Object { [IO.Path]::GetExtension($_) -in '.dll', '.so', '.dylib' }
        }
    }
}
if ($LASTEXITCODE -ne 0 -or !$binary -or !$libraries.Count) { throw 'Agent or site plugin build failed.' }
$buildDir = Split-Path -Parent $binary
$dest = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { $buildDir }
$plugins = Join-Path $dest 'plugins'
[IO.Directory]::CreateDirectory($plugins) | Out-Null
if ($buildDir -ne $dest) {
    $exe = Join-Path $dest (Split-Path -Leaf $binary)
    Copy-Item -LiteralPath $binary -Destination $exe
    $binary = $exe
}
foreach ($library in $libraries) {
    Copy-Item -LiteralPath $library -Destination $plugins
}
$binary
