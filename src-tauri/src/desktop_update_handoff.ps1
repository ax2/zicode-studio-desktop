$ErrorActionPreference = 'Stop'
$handoff = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ZICODE_UPDATE_HANDOFF)) | ConvertFrom-Json
Remove-Item Env:ZICODE_UPDATE_HANDOFF
$ready = $false
$stream = $null
$parent = $null

function Write-Result([string]$status, [string]$message) {
    $destination = [IO.Path]::Combine($handoff.updatesDir, 'result.json')
    $temp = [IO.Path]::Combine($handoff.updatesDir, ("result-" + [guid]::NewGuid() + ".tmp"))
    $json = @{ version=$handoff.version; status=$status; message=$message } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($temp, $json, [Text.UTF8Encoding]::new($false))
    if ([IO.File]::Exists($destination)) { [IO.File]::Replace($temp, $destination, $null) }
    else { [IO.File]::Move($temp, $destination) }
}
function Quote-Path([string]$value) {
    # Windows paths cannot contain a double quote; double trailing slashes before the closing quote.
    if ($value.Contains('"')) { throw 'Invalid restart argument' }
    return '"' + ($value -replace '(\\+)$', '$1$1') + '"'
}

try {
    $executable = [IO.Path]::GetFullPath($handoff.executable)
    $target = [IO.Path]::GetDirectoryName($executable)
    $installer = [IO.Path]::GetFullPath($handoff.installer)
    if ([IO.Path]::GetDirectoryName($installer) -ine [IO.Path]::GetFullPath($handoff.updatesDir) -or
        [IO.Path]::GetFileName($installer) -notmatch '^candidate-[0-9a-f-]{36}\.exe$' -or
        $handoff.expectedSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid update candidate' }
    $registered = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ZiCode Studio Desktop'
    if (!$registered.InstallLocation -or [IO.Path]::GetFullPath($registered.InstallLocation.Trim('"')).TrimEnd('\') -ine $target.TrimEnd('\')) {
        throw 'Start the installed copy of ZiCode Studio Desktop to update it'
    }
    $parent = [Diagnostics.Process]::GetProcessById($handoff.pid)
    if ($parent.MainModule.FileName -ine $executable) { throw 'Studio process identity changed' }
    $null = $parent.Handle
    $appName = [IO.Path]::GetFileNameWithoutExtension($executable)
    if (@([Diagnostics.Process]::GetProcessesByName($appName) | Where-Object Id -ne $handoff.pid).Count) {
        throw 'Close other Studio instances before installing the update'
    }
    # The open read-only sharing mode pins these same bytes through setup launch and execution.
    $stream = [IO.File]::Open($installer, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
    if ($actual -cne $handoff.expectedSha256) { throw 'Downloaded installer checksum changed' }
    # Resolve the inbox Windows PowerShell module even if a launcher uses PowerShell 7.
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -notin @('Valid','NotSigned')) { throw "Windows rejected installer signature: $($signature.Status)" }
    [Console]::Out.WriteLine('ready')
    [Console]::Out.Flush()
    $ready = $true
    if (!$parent.WaitForExit(120000)) { throw 'Studio did not exit in time to install the update' }
    if ([Diagnostics.Process]::GetProcessesByName($appName).Length) { throw 'Another Studio instance is running' }
    # NSIS requires /D as the final unquoted argument even when the directory contains spaces.
    $setup = Start-Process -FilePath $installer -ArgumentList "/S /NS /D=$target" -PassThru
    $setup.WaitForExit()
    if ($setup.ExitCode -ne 0) { throw "Windows installer exited with code $($setup.ExitCode)" }
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($executable).ProductVersion
    if ($version -ne $handoff.version -and $version -ne "$($handoff.version).0") { throw 'Installed application version does not match the update' }
    Write-Result 'installed' ''
    $restart = @{ FilePath=$executable; WorkingDirectory=$target }
    if ($handoff.arguments.Count) { $restart.ArgumentList = ($handoff.arguments | ForEach-Object { Quote-Path $_ }) -join ' ' }
    try { Start-Process @restart }
    catch { Write-Result 'installed' 'Update installed. Open ZiCode Studio Desktop to continue.' }
} catch {
    if ($ready) { Write-Result 'failed' $_.Exception.Message }
    else { [Console]::Out.WriteLine($_.Exception.Message); [Console]::Out.Flush() }
    exit 1
} finally {
    if ($parent) { $parent.Dispose() }
    if ($stream) { $stream.Dispose() }
    if ($ready) { [IO.File]::Delete($installer) }
}
