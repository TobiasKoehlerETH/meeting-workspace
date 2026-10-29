param([string[]]$AppDirectories)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $projectRoot 'src-tauri\speaker-runtime'
if (-not $AppDirectories) {
    $AppDirectories = @(
        (Join-Path $projectRoot 'target\windows-app\release'),
        (Join-Path $projectRoot 'target\windows-app\release\deps')
    )
}
$required = @('segmentation.onnx', 'embedding.onnx',
    'sherpa-onnx-offline-speaker-diarization.exe',
    'onnxruntime.dll', 'onnxruntime_providers_shared.dll')
foreach ($name in $required) {
    $path = Join-Path $sourceDirectory $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0) {
        throw "Speaker runtime file is missing or empty: $path. Run scripts/prepare-speaker-runtime.py first."
    }
}
# The app checks segmentation.onnx first, so copy it after its dependencies.
$files = Get-ChildItem -LiteralPath $sourceDirectory -File |
    Sort-Object @{ Expression = { $_.Name -eq 'segmentation.onnx' } }, Name
$hashes = @{}
foreach ($file in $files) { $hashes[$file.Name] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
foreach ($appDirectory in $AppDirectories) {
    $destination = Join-Path ([IO.Path]::GetFullPath($appDirectory)) 'speaker-runtime'
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    foreach ($file in $files) {
        $target = Join-Path $destination $file.Name
        if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or
            (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hashes[$file.Name]) {
            Copy-Item -LiteralPath $file.FullName -Destination $target -Force
        }
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hashes[$file.Name]) {
            throw "Speaker runtime copy failed verification: $target"
        }
    }
    Write-Host "Speaker runtime verified: $destination"
}
