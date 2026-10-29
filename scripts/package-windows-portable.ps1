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
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src-tauri\runtime') -Filter '*.dll' -File | Copy-Item -Destination $portableDirectory -Force
foreach ($resourceFolder in @('templates', 'licenses')) {
    $resourceDestination = Join-Path $portableDirectory $resourceFolder
    New-Item -ItemType Directory -Force -Path $resourceDestination | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $projectRoot ('src-tauri\' + $resourceFolder)) -Force |
        Copy-Item -Destination $resourceDestination -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $portableDirectory -Force
& "$PSScriptRoot\stage-speaker-runtime.ps1" -AppDirectories @($portableDirectory)
Set-Content -LiteralPath (Join-Path $portableDirectory 'README.txt') -Value @'
Run Meeting-Workspace.exe. Keep the executables, DLLs, templates folder, and LICENSE together. No installation is required. Application data is stored in your Windows application-data directory.

Download speech and summary models once in Settings. Recording saves microphone and system audio to recording.wav. Stop saves audio only. Select the saved meeting and click Transcribe to run local transcription. Listen to recording plays saved audio in the app. No live transcript is generated. New setups use quantized Whisper Turbo. Parakeet remains available as another local option.

Summaries use the built-in local AI. Set Settings > Summary > Summary lines to 1-50 bullet lines. Model weights stay in the Windows application-data directory. Inference requires no API key or internet connection.

Speaker detection runs locally when you click Transcribe using the bundled speaker-runtime folder. Keep that folder with the executable. Settings > Transcription lets you turn it off or specify the number of speakers (0 means Auto). Rename speakers in the transcript's Speaker names section. Regenerate summaries to use updated names. Labels are estimates and do not identify Teams accounts.

To start minimized, use Meeting-Workspace.exe --minimized or enable Settings > General > Start minimized. Use Open Main Window in the tray menu to return. Starting a recording from the tray opens the window. The tray tooltip shows recording status. Use --show to open the window and override the saved launch preference for a new session.
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
