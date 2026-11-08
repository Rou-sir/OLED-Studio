$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tools = Join-Path $root '.tools'
$targets = @(
    @{
        Folder = 'avr'
        Url = 'https://downloads.arduino.cc/tools/avr-gcc-7.3.0-atmel3.6.1-arduino7-i686-w64-mingw32.zip'
    },
    @{
        Folder = 'xpack-arm-none-eabi-gcc-13.2.1-1.1'
        Url = 'https://github.com/xpack-dev-tools/arm-none-eabi-gcc-xpack/releases/download/v13.2.1-1.1/xpack-arm-none-eabi-gcc-13.2.1-1.1-win32-x64.zip'
    }
)
foreach ($target in $targets) {
    $folder = Join-Path $tools $target.Folder
    if (-not (Test-Path $folder)) {
        $zip = Join-Path $tools ($target.Folder + '.zip')
        & curl.exe -fL --retry 2 $target.Url -o $zip
        if ($LASTEXITCODE -ne 0) { throw "Target compiler download failed: $($target.Folder)" }
        Expand-Archive -Path $zip -DestinationPath $tools -Force
        Remove-Item -LiteralPath $zip
    }
}
$core = Join-Path $root 'vendor\arduino-avr'
if (-not (Test-Path (Join-Path $core 'cores\arduino\Arduino.h'))) {
    & git clone --depth 1 --branch 1.8.6 --filter=blob:none --sparse https://github.com/arduino/ArduinoCore-avr.git $core
    if ($LASTEXITCODE -ne 0) { throw 'Arduino core retrieval failed' }
    & git -C $core sparse-checkout set cores/arduino variants/standard
    if ($LASTEXITCODE -ne 0) { throw 'Arduino core checkout failed' }
}
$library = Join-Path $root 'vendor\u8g2-arduino'
if (-not (Test-Path (Join-Path $library 'src\U8g2lib.h'))) {
    & git clone --depth 1 --branch 2.36.5 --filter=blob:none --sparse https://github.com/olikraus/U8g2_Arduino.git $library
    if ($LASTEXITCODE -ne 0) { throw 'Arduino U8g2 release retrieval failed' }
    & git -C $library sparse-checkout set src
    if ($LASTEXITCODE -ne 0) { throw 'Arduino U8g2 release checkout failed' }
}
