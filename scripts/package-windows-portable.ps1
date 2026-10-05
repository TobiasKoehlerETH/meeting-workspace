param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDirectory = Join-Path $projectRoot 'target\windows-app\release'
$applicationVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
$portableDirectory = Join-Path $OutputDirectory ('Meeting-Workspace-Portable-' + $applicationVersion)
New-Item -ItemType Directory -Force -Path $portableDirectory | Out-Null

Copy-Item -LiteralPath (Join-Path $releaseDirectory 'meeting-workspace.exe') -Destination (Join-Path $portableDirectory 'Meeting-Workspace.exe') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri\binaries\ffmpeg-x86_64-pc-windows-msvc.exe') -Destination (Join-Path $portableDirectory 'ffmpeg.exe') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri\binaries\llama-helper-x86_64-pc-windows-msvc.exe') -Destination (Join-Path $portableDirectory 'llama-helper.exe') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri\binaries\nemotron-helper-x86_64-pc-windows-msvc.exe') -Destination (Join-Path $portableDirectory 'nemotron-helper.exe') -Force
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src-tauri\runtime') -Filter '*.dll' -File | Copy-Item -Destination $portableDirectory -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri\templates') -Destination $portableDirectory -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $portableDirectory -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri\licenses') -Destination $portableDirectory -Recurse -Force
Set-Content -LiteralPath (Join-Path $portableDirectory 'README.txt') -Value @'
Run Meeting-Workspace.exe. Keep the executables, DLLs, templates folder, and LICENSE together. No installation is required. Application data is stored in your Windows application-data directory.

For API transcription, select Settings > Transcription > API OpenRouter and save an API key. Whisper Large V3 Turbo is the default speech model. Local Parakeet and Whisper remain available. Personal API keys are not included in this package.

For local two-stage transcription, select Settings > Transcription > Local Nemotron live + Parakeet final. Download both models and enable the mode. Microphone audio is saved as recording.wav. Nemotron supplies the live transcript; Parakeet creates the final transcript after Stop. The model weights stay in the Windows application-data directory.
'@

$zipPath = Join-Path $OutputDirectory ('Meeting-Workspace-Portable-' + $applicationVersion + '.zip')
Compress-Archive -LiteralPath $portableDirectory -DestinationPath $zipPath -Force
$installerPath = Join-Path $OutputDirectory 'Meeting-Workspace-Setup.exe'
Copy-Item -LiteralPath (Join-Path $releaseDirectory ('bundle\nsis\Meeting Workspace_' + $applicationVersion + '_x64-setup.exe')) -Destination $installerPath -Force
@($installerPath, $zipPath) | ForEach-Object {
    $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256
    $hash.Hash + '  ' + (Split-Path -Leaf $hash.Path)
} | Set-Content -LiteralPath (Join-Path $OutputDirectory 'SHA256.txt')
Write-Output $installerPath
Write-Output $zipPath
