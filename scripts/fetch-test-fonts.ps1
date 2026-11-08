$ErrorActionPreference = 'Stop'
$destination = Join-Path (Split-Path $PSScriptRoot -Parent) 'build\test-fonts'
New-Item -ItemType Directory -Force $destination | Out-Null
$files = @{
    'MaShanZheng-Regular.ttf' = 'https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/MaShanZheng-Regular.ttf'
    'MaShanZheng-OFL.txt' = 'https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/OFL.txt'
    'NotoSansCJKsc-Regular.otf' = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf'
    'NotoSansCJK-LICENSE.txt' = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE'
}
foreach ($entry in $files.GetEnumerator()) {
    $target = Join-Path $destination $entry.Key
    if (-not (Test-Path $target)) {
        & curl.exe -fL --retry 2 $entry.Value -o $target
        if ($LASTEXITCODE -ne 0) { throw "Test font download failed: $($entry.Key)" }
    }
    Get-FileHash $target -Algorithm SHA256 | Select-Object Hash,Path
}
