$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$directML = Join-Path $projectRoot 'target\windows-app\release\DirectML.dll'
if (-not (Test-Path -LiteralPath $directML)) {
    throw 'The ONNX Runtime DirectML DLL is missing. Build the Windows application before bundling.'
}
Copy-Item -LiteralPath $directML -Destination (Join-Path $projectRoot 'src-tauri\runtime\DirectML.dll')
