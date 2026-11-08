$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tools = Join-Path $root '.tools'
New-Item -ItemType Directory -Force $tools | Out-Null

$nodeVersion = 'v24.11.0'
$nodeDir = Join-Path $tools "node-$nodeVersion-win-x64"
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    $zip = Join-Path $tools 'node.zip'
    & curl.exe -fL --retry 2 "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-x64.zip" -o $zip
    if ($LASTEXITCODE -ne 0) { throw 'Node.js download failed' }
    & curl.exe -fL --retry 2 "https://nodejs.org/dist/$nodeVersion/SHASUMS256.txt" -o (Join-Path $tools 'node-SHASUMS256.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Node.js checksum download failed' }
    $line = Get-Content (Join-Path $tools 'node-SHASUMS256.txt') | Where-Object { $_ -match " node-$nodeVersion-win-x64.zip$" }
    if (-not $line) { throw 'Node.js checksum entry missing' }
    $expected = ($line -split '\s+')[0]
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) { throw 'Node.js checksum mismatch' }
    Expand-Archive -Path $zip -DestinationPath $tools -Force
    Remove-Item -LiteralPath $zip
}
$env:Path = "$nodeDir;$env:Path"
$sdk = Join-Path $tools 'emsdk'
if (-not (Test-Path (Join-Path $sdk 'emsdk.py'))) {
    & git clone --depth 1 https://github.com/emscripten-core/emsdk.git $sdk
    if ($LASTEXITCODE -ne 0) { throw 'Emscripten SDK clone failed' }
}
& python (Join-Path $sdk 'emsdk.py') install 4.0.19
if ($LASTEXITCODE -ne 0) { throw 'Emscripten installation failed' }
& python (Join-Path $sdk 'emsdk.py') activate 4.0.19
if ($LASTEXITCODE -ne 0) { throw 'Emscripten activation failed' }
Write-Output "Local tools ready. Node: $nodeDir"
$source = Join-Path $root 'vendor\u8g2'
if (-not (Test-Path (Join-Path $source 'csrc\u8g2.h'))) {
    & git clone --depth 1 --branch 2.36.5 --filter=blob:none --sparse https://github.com/olikraus/u8g2.git $source
    if ($LASTEXITCODE -ne 0) { throw 'U8g2 source retrieval failed' }
    & git -C $source sparse-checkout set csrc cppsrc tools/font/bdfconv
    if ($LASTEXITCODE -ne 0) { throw 'U8g2 source checkout failed' }
}
