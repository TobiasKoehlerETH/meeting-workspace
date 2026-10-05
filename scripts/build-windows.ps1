param([switch]$NativeOnly, [switch]$AppOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$developerCommand = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $developerCommand)) {
    throw 'MSVC Build Tools are missing. Install the C++ build tools before building Meeting Workspace.'
}
$compilerEnvironment = & cmd.exe /d /c scripts\compiler-environment.cmd
if ($LASTEXITCODE -ne 0) { throw 'MSVC environment initialization failed.' }
foreach ($entry in $compilerEnvironment) {
    if ($entry -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
$env:PATH = "$projectRoot\.build-tools\Scripts;$env:PATH"
$env:LIBCLANG_PATH = "$projectRoot\.build-tools\Lib\site-packages\clang\native"
$env:CMAKE_GENERATOR = 'NMake Makefiles'
$env:CARGO_BUILD_JOBS = '8'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '8'
$env:CXXFLAGS = '/utf-8'

$redistRoot = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Redist\MSVC'
$redistVersion = Get-ChildItem -LiteralPath $redistRoot -Directory |
    Where-Object Name -Match '^\d+\.\d+\.\d+$' |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $redistVersion) { throw 'The MSVC redistributable files are missing from the build tools.' }
New-Item -ItemType Directory -Force src-tauri\runtime | Out-Null
Get-ChildItem -LiteralPath (Join-Path $redistVersion.FullName 'x64') -Recurse -File -Filter '*.dll' |
    Copy-Item -Destination src-tauri\runtime

if ($AppOnly) {
    cargo build --release --locked -p meeting-workspace --features tauri/custom-protocol --target-dir target/windows-app
    if ($LASTEXITCODE -ne 0) { throw 'The Meeting Workspace application failed to build.' }
    return
}

if ($NativeOnly) {
    cargo build --release --locked -p llama-helper
    if ($LASTEXITCODE -ne 0) { throw 'The local summary helper failed to build.' }
    New-Item -ItemType Directory -Force src-tauri\binaries | Out-Null
    Copy-Item -LiteralPath target\release\llama-helper.exe -Destination src-tauri\binaries\llama-helper-x86_64-pc-windows-msvc.exe
    return
}

& $PSCommandPath -NativeOnly
$env:CARGO_TARGET_DIR = "$projectRoot\target\windows-app"
pnpm tauri build --config src-tauri/tauri.local.conf.json --bundles nsis --no-sign --ci
if ($LASTEXITCODE -ne 0) { throw 'The Meeting Workspace Windows build failed.' }
