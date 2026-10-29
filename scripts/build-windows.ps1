param(
    [switch]$NativeOnly, [switch]$AppOnly, [switch]$TestTranscription,
    [switch]$TestWhisperGpu, [switch]$TestUnit, [switch]$TestHelper,
    [switch]$TestSummary, [switch]$TestSpeakers,
    [ValidateSet('vulkan', 'cpu')][string]$SpeechBackend = 'vulkan'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$speechFeatureArgs = @()
if (-not $NativeOnly -and -not $TestHelper) {
    if ($TestWhisperGpu -and $SpeechBackend -ne 'vulkan') {
        throw 'The GPU transcription check requires -SpeechBackend vulkan.'
    }
    if ($SpeechBackend -eq 'vulkan') {
        if (-not $env:VULKAN_SDK) {
            $env:VULKAN_SDK = Join-Path $projectRoot '.build-tools\vulkan-sdk'
        }
        foreach ($sdkFile in @('Bin\glslc.exe', 'Include\vulkan\vulkan.h', 'Lib\vulkan-1.lib')) {
            if (-not (Test-Path -LiteralPath (Join-Path $env:VULKAN_SDK $sdkFile))) {
                throw "Vulkan SDK file missing: $sdkFile. Set VULKAN_SDK to the SDK directory (see BUILD-WINDOWS.md), or use -SpeechBackend cpu."
            }
        }
        $env:PATH = "$env:VULKAN_SDK\Bin;$env:PATH"
        $speechFeatureArgs = @('--features', 'vulkan')
    }
    Write-Host "Whisper backend: $SpeechBackend"
}

$buildTools = @(
    '.build-tools\Scripts\cmake.exe',
    '.build-tools\Lib\site-packages\clang\native\libclang.dll'
)
foreach ($toolPath in $buildTools) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $toolPath))) {
        throw "Missing build dependency: $toolPath. Follow the CMake and libclang setup in BUILD-WINDOWS.md."
    }
}

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
    ForEach-Object {
        $destination = Join-Path $projectRoot ('src-tauri\runtime\' + $_.Name)
        if (-not (Test-Path -LiteralPath $destination) -or
            (Get-FileHash -LiteralPath $_.FullName).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
            Copy-Item -LiteralPath $_.FullName -Destination $destination
        }
    }

if (-not $NativeOnly -and -not $TestHelper) {
    & .\.build-tools\Scripts\python.exe scripts\prepare-speaker-runtime.py
    if ($LASTEXITCODE -ne 0) { throw 'Local speaker runtime preparation failed.' }
    & "$PSScriptRoot\stage-speaker-runtime.ps1"
}

if ($TestSummary) {
    & $PSCommandPath -NativeOnly
    $env:MEETING_WORKSPACE_LLAMA_HELPER = Join-Path $projectRoot 'src-tauri\binaries\llama-helper-x86_64-pc-windows-msvc.exe'
    cargo test --release --locked -p meeting-workspace @speechFeatureArgs --lib local_summary_respects_requested_line_limits --target-dir target/windows-app -- --ignored --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Local summary inference checks failed.' }
    return
}

if ($TestHelper) {
    cargo test --release --locked -p llama-helper
    if ($LASTEXITCODE -ne 0) { throw 'Local summary helper tests failed.' }
    return
}

if ($TestUnit -or $TestTranscription -or $TestWhisperGpu -or $TestSpeakers -or $AppOnly) {
    # Tauri validates bundled resources even when compiling native unit tests.
    & $PSCommandPath -NativeOnly
}

if ($TestUnit) {
    cargo test --release --locked -p meeting-workspace @speechFeatureArgs --lib --target-dir target/windows-app
    if ($LASTEXITCODE -ne 0) { throw 'Native unit tests failed.' }
    return
}

if ($TestSpeakers) {
    $fixture = Join-Path $projectRoot '.build-tools\speakers\four-speakers.wav'
    $expectedHash = 'BEDF036CAED208386C67B4EF4B11F83D74DD0D420B102163A1C33CD09CDE7010'
    if (-not (Test-Path -LiteralPath $fixture)) {
        Invoke-WebRequest 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/0-four-speakers-zh.wav' -OutFile $fixture
    }
    if ((Get-FileHash -LiteralPath $fixture).Hash -ne $expectedHash) { throw 'Speaker fixture checksum mismatch.' }
    cargo test --release --locked -p meeting-workspace @speechFeatureArgs --lib local_four_speaker_smoke --target-dir target/windows-app -- --ignored --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Local speaker inference check failed.' }
    return
}

if ($TestTranscription -or $TestWhisperGpu) {
    $env:MEETING_WORKSPACE_SPEECH_FIXTURE = Join-Path $projectRoot '.build-tools\transcription-smoke.wav'
    powershell.exe -NoProfile -NonInteractive -Command {
        Add-Type -AssemblyName System.Speech
        $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
        try {
            $speaker.SetOutputToWaveFile($env:MEETING_WORKSPACE_SPEECH_FIXTURE)
            $speaker.Speak('This is a test of meeting transcription.')
        } finally {
            $speaker.Dispose()
        }
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the synthetic transcription test audio.' }
    if ($TestWhisperGpu) {
        $gpuCheckLog = Join-Path $projectRoot '.build-tools\whisper-gpu-check.log'
        cargo test --release --locked -p meeting-workspace @speechFeatureArgs --lib whisper_vulkan_transcribes_speech --target-dir target/windows-app -- --ignored --nocapture 2>&1 |
            Tee-Object -FilePath $gpuCheckLog
        if ($LASTEXITCODE -ne 0) { throw 'Whisper GPU transcription check failed.' }
        if (-not (Select-String -LiteralPath $gpuCheckLog -SimpleMatch 'using Vulkan backend' -Quiet)) {
            throw "Transcription did not confirm Vulkan execution. Inspect $gpuCheckLog."
        }
    } else {
        cargo test --release --locked -p meeting-workspace @speechFeatureArgs --lib parakeet_final_pass_from_original_speech --target-dir target/windows-app -- --ignored --nocapture
        if ($LASTEXITCODE -ne 0) { throw 'Local Parakeet final-pass check failed.' }
    }
    return
}

if ($AppOnly) {
    cargo build --release --locked -p meeting-workspace @speechFeatureArgs --features tauri/custom-protocol --target-dir target/windows-app
    if ($LASTEXITCODE -ne 0) { throw 'The Meeting Workspace application failed to build.' }
    return
}

if ($NativeOnly) {
    cargo build --release --locked -p llama-helper
    if ($LASTEXITCODE -ne 0) { throw 'The local summary helper failed to build.' }
    New-Item -ItemType Directory -Force src-tauri\binaries | Out-Null
    $helperSource = Join-Path $projectRoot 'target\release\llama-helper.exe'
    $helperDestination = Join-Path $projectRoot 'src-tauri\binaries\llama-helper-x86_64-pc-windows-msvc.exe'
    # An unchanged resource must not trigger another full native compilation.
    if (-not (Test-Path -LiteralPath $helperDestination) -or
        (Get-FileHash -LiteralPath $helperSource).Hash -ne (Get-FileHash -LiteralPath $helperDestination).Hash) {
        Copy-Item -LiteralPath $helperSource -Destination $helperDestination
    }
    return
}

& $PSCommandPath -NativeOnly
$env:CARGO_TARGET_DIR = "$projectRoot\target\windows-app"
# pnpm's dependency links must resolve to their actual package directories.
$env:NODE_OPTIONS = (([string]$env:NODE_OPTIONS) -replace '(^|\s)--preserve-symlinks(?:-main)?(?=\s|$)', '$1').Trim()
pnpm tauri build @speechFeatureArgs --config src-tauri/tauri.local.conf.json --bundles nsis --no-sign --ci
if ($LASTEXITCODE -ne 0) { throw 'The Meeting Workspace Windows build failed.' }
