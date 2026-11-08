param(
    [ValidateSet('build', 'build-native', 'test', 'test-browser', 'test-fonts', 'test-studio', 'build-targets', 'test-avr')]
    [string]$Task = 'build'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$node = Join-Path $root '.tools\node-v24.11.0-win-x64'
$env:Path = "$node;$env:Path"
$env:PYTHONUTF8 = '1'
switch ($Task) {
    'build-native' { & python 'scripts\build_native.py' }
    'build-targets' { & python 'scripts\build_targets.py' }
    'test-avr' { & (Join-Path $node 'node.exe') 'scripts\test-avr.mjs' }
    'test-browser' { & (Join-Path $node 'npm.cmd') run test:browser }
    'test-fonts' { & (Join-Path $node 'npm.cmd') run test:fonts }
    'test-studio' { & (Join-Path $node 'npm.cmd') run test:studio }
    'test' { & (Join-Path $node 'npm.cmd') test }
    'build' { & (Join-Path $node 'npm.cmd') run build }
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
