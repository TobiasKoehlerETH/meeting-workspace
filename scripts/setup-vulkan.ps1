$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkDirectory = Join-Path $projectRoot '.build-tools\vulkan-sdk'
$sdkVersion = '1.4.363.0'
$installer = Join-Path $projectRoot ".build-tools\vulkansdk-windows-X64-$sdkVersion.exe"
$expectedHash = '94a82d378f7a5e3e54c9db7d2fb7016af136e14ac0a18dbf0f2f67a36352d141'
$requiredFiles = @('Bin\glslc.exe', 'Include\vulkan\vulkan.h', 'Lib\vulkan-1.lib')
if (@($requiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $sdkDirectory $_)) }).Count -eq 0) {
    Write-Host "Vulkan SDK already available at $sdkDirectory"
    return
}

if (-not (Test-Path -LiteralPath $installer)) {
    New-Item -ItemType Directory -Force (Split-Path -Parent $installer) | Out-Null
    Invoke-WebRequest "https://sdk.lunarg.com/sdk/download/$sdkVersion/windows/vulkansdk-windows-X64-$sdkVersion.exe" -OutFile $installer
}
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $expectedHash) {
    throw "Vulkan SDK checksum mismatch. Remove $installer and run this script again."
}
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O="LunarG, Inc\."') {
    throw 'The Vulkan SDK installer must have a valid LunarG signature.'
}

# copy_only keeps the SDK inside the project without registry or system PATH changes.
$installProcess = Start-Process -FilePath $installer -ArgumentList @(
    '--root', ('"' + $sdkDirectory + '"'), '--accept-licenses', '--default-answer',
    '--confirm-command', 'install', 'copy_only=1'
) -WindowStyle Hidden -Wait -PassThru
if ($installProcess.ExitCode -ne 0) {
    throw "Vulkan SDK installation failed with exit code $($installProcess.ExitCode)."
}
foreach ($sdkFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $sdkDirectory $sdkFile))) {
        throw "The Vulkan SDK installation did not produce $sdkFile."
    }
}
Write-Host "Vulkan SDK ready at $sdkDirectory"
