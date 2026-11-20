[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PersonalProfile,
    [Parameter(Mandatory)][string]$TestProfile,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9_-]{0,47}$')][string]$TestName,
    [ValidatePattern('^[a-zA-Z0-9_.-]{1,128}$')][string]$Scene = 'programming',
    [ValidatePattern('^[a-zA-Z0-9_.-]{1,128}$')][string]$Provider = 'openai-studio',
    [switch]$Synthetic
)
$ErrorActionPreference = 'Stop'
if ($TestName -cnotmatch '^[a-z0-9][a-z0-9_-]{0,47}$') { throw 'Invalid test profile name' }
# Operator-only local provisioning. No secret argument, file, child process or transcript output.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class StudioModelVault {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Credential {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool Write(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr value);
    [DllImport("kernel32.dll", EntryPoint="CreateFileW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle Open(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint="GetFinalPathNameByHandleW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint FinalPath(SafeFileHandle file, StringBuilder path, uint size, uint flags);
    public static string Canonical(string path) {
        using (var handle=Open(path,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var value=new StringBuilder(32768);
            var length=FinalPath(handle,value,(uint)value.Capacity,0);
            if (length==0 || length>=value.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
            return value.ToString().ToLowerInvariant();
        }
    }
    public static void Store(string account, SecureString secret) {
        var pointer=Marshal.SecureStringToCoTaskMemUnicode(secret);
        try {
            var credential=new Credential {Type=1, TargetName=account+".ZiCode Studio Desktop", UserName=account,
                CredentialBlob=pointer,CredentialBlobSize=checked((uint)secret.Length*2),Persist=3};
            if (!Write(ref credential,0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {Marshal.ZeroFreeCoTaskMemUnicode(pointer);}
    }
    public static void ReplaceIndex(string source, string destination) {
        if (System.IO.File.Exists(destination)) System.IO.File.Replace(source,destination,null);
        else System.IO.File.Move(source,destination);
    }
    public static bool Configured(string account) {
        IntPtr pointer;
        if (!Read(account+".ZiCode Studio Desktop",1,0,out pointer)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {return ((Credential)Marshal.PtrToStructure(pointer,typeof(Credential))).CredentialBlobSize>0;}
        finally {CredFree(pointer);}
    }
}
'@
function Account([string]$Root, [string]$Name, [string]$SceneId, [string]$ProviderId) {
    $canonical = [StudioModelVault]::Canonical($Root)
    if ($canonical -match '[^\x00-\x7F]') { throw 'Use Studio settings for profiles with non-ASCII paths' }
    $scope = "profile:$canonical" + [char]0
    if ($Name) { $scope = "named-test:$Name" + [char]0 + $scope }
    $value = $scope + $SceneId + [char]0 + $ProviderId
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)) }
    finally { $sha.Dispose() }
    'scene-provider-' + [Convert]::ToHexString($digest[0..19]).ToLowerInvariant()
}
function Check-Owned([string]$Root) {
    if (-not [IO.Path]::IsPathFullyQualified($Root)) { throw 'Profile directory must be absolute' }
    $marker = Join-Path $Root 'profile.json'
    if ([IO.File]::ReadAllText($marker) -cne "{`"schemaVersion`":1,`"kind`":`"zicode-isolated-desktop`"}`n") { throw 'Profile marker is invalid' }
    $item = Get-Item -LiteralPath $marker
    while ($item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Profile must not contain links or junctions' }
        if ($item -is [IO.DirectoryInfo]) { $item = $item.Parent } else { $item = $item.Directory }
    }
    if ($Synthetic) {
        $owner = Join-Path (Split-Path $Root) 'owner.json'
        if ((Get-Content -LiteralPath $owner -Raw | ConvertFrom-Json).purpose -cne 'synthetic named vault acceptance') { throw 'Synthetic mode requires a disposable acceptance fixture' }
    }
}
$locks = @()
$temporaryFiles = @()
$secret = $null
try {
    if ([IO.Path]::GetFullPath($PersonalProfile) -eq [IO.Path]::GetFullPath($TestProfile)) { throw 'Use separate personal and test directories' }
    if (-not $Synthetic) {
        $permission = Join-Path $PersonalProfile 'system/credentials/profile-permission.json'
        $document = Get-Content -LiteralPath $permission -Raw | ConvertFrom-Json
        if ($document.schemaVersion -ne 1 -or $document.systemCredentials -ne $true) { throw 'Personal profile has not enabled system credentials' }
    }
    $plans = @()
    foreach ($selection in @(@{Root=$PersonalProfile;Name=$null}, @{Root=$TestProfile;Name=$TestName})) {
        $root = $selection.Root; Check-Owned $root
        $lock = [IO.File]::Open((Join-Path $root 'profile.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
        $locks += $lock; $lock.Lock(0,1) # Refuse to race an active Studio profile.
        $directory = Join-Path $root 'system/credentials'
        if ($selection.Name) { $directory = Join-Path $directory "test-profiles/$($selection.Name)" }
        $ancestor = $directory
        while ($ancestor) {
            if (Test-Path -LiteralPath $ancestor) {
                if ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Credential directories must not contain links or junctions' }
            }
            $ancestor = Split-Path $ancestor
        }
        [IO.Directory]::CreateDirectory($directory) | Out-Null
        # Validate every existing reference before updating the vault or index.
        $indexPath = Join-Path $directory 'index.json'
        if ((Test-Path -LiteralPath $indexPath) -and ((Get-Item -LiteralPath $indexPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Credential index must not be a link' }
        $index = @{version=1;entries=@()}
        if (Test-Path -LiteralPath $indexPath) {
            $index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json -AsHashtable
            if ($index.version -ne 1) { throw 'Unsupported credential index' }
            foreach ($entry in $index.entries) {
                if ($entry.sceneId -notmatch '^[a-zA-Z0-9_.-]{1,128}$' -or $entry.provider -notmatch '^[a-zA-Z0-9_.-]{1,128}$' -or
                    $entry.account -cne (Account $root $selection.Name $entry.sceneId $entry.provider)) { throw 'Credential index belongs to another profile' }
            }
        }
        $account = Account $root $selection.Name $Scene $Provider
        $index.entries = @($index.entries | Where-Object { -not ($_.sceneId -ceq $Scene -and $_.provider -ceq $Provider) }) + @(@{sceneId=$Scene;provider=$Provider;account=$account})
        $temporary = Join-Path $directory ("index.json.tmp-" + [guid]::NewGuid().ToString('N'))
        $temporaryFiles += $temporary
        [IO.File]::WriteAllText($temporary, ($index | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
        $plans += @{Path=$indexPath;Temporary=$temporary;Account=$account;Name=$selection.Name}
    }
    if ($Synthetic) { $secret = ConvertTo-SecureString 'synthetic-not-a-real-api-key' -AsPlainText -Force }
    else { $secret = Read-Host 'Enter the model API key once (hidden)' -AsSecureString }
    if ($secret.Length -lt 1 -or $secret.Length -gt 2560) { throw 'Credential must contain 1–2560 UTF-16 characters' }
    foreach ($plan in $plans) {
        [StudioModelVault]::Store($plan.Account,$secret)
        [StudioModelVault]::ReplaceIndex($plan.Temporary,$plan.Path)
        if (-not [StudioModelVault]::Configured($plan.Account)) { throw 'Credential verification failed' }
        [pscustomobject]@{profile=$(if ($plan.Name) {$plan.Name} else {'personal'});provider=$Provider;configured=$true;index=$plan.Path}
    }
} finally {
    if ($secret) { $secret.Dispose() }
    foreach ($file in $temporaryFiles) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
    foreach ($lock in $locks) { $lock.Dispose() }
}
