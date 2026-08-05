param(
    [Parameter(Mandatory = $true)][string]$CertPath,
    [string]$TimestampUrl = 'http://timestamp.digicert.com',
    [string]$InstallerPath = 'target\release\bundle\nsis\ZiCode Studio Desktop_0.1.0_x64-setup.exe',
    [string]$ExePath = 'target\release\zicode-studio-desktop.exe'
)

# Sign the release EXE and NSIS installer with a Windows Authenticode
# certificate. Run from the repo root after `bun run build`:
#
#   $env:ZICODE_SIGN_PASSWORD = '<cert-password>'   # optional, for PFX
#   powershell -File scripts\sign-release.ps1 -CertPath C:\path\to\cert.pfx
#
# The certificate and password are never stored in the repository.
#
# Verified 2026-08-06 with a self-signed code-signing certificate: SHA-256
# signature and RFC3161 DigiCert timestamp are applied correctly; the only
# reason verification reports "untrusted root" with such a test certificate
# is that the signing root is not a public CA.

$ErrorActionPreference = 'Stop'

$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter 'signtool.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) {
    throw 'signtool.exe not found; install the Windows SDK (Windows Kits\10\bin)'
}

$common = @('sign', '/fd', 'SHA256', '/tr', $TimestampUrl, '/td', 'SHA256', '/f', $CertPath)
if ($env:ZICODE_SIGN_PASSWORD) {
    $common += @('/p', $env:ZICODE_SIGN_PASSWORD)
}

foreach ($target in @($ExePath, $InstallerPath)) {
    $resolved = if ([System.IO.Path]::IsPathRooted($target)) {
        $target
    } else {
        Join-Path (Get-Location) $target
    }
    if (-not (Test-Path -LiteralPath $resolved)) {
        throw "missing $target; run bun run build first"
    }
    Write-Output "signing $target ..."
    & $signtool.FullName @common $resolved
    if ($LASTEXITCODE -ne 0) {
        throw "signtool failed for $target"
    }
}

Write-Output 'signing complete'
