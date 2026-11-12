param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Sample,
    [Parameter(Mandatory)][string]$SecondSample
)
$ErrorActionPreference = 'Stop'
$Probe = (Resolve-Path -LiteralPath $Probe).Path
$root = (New-Item -ItemType Directory -Path (
    Join-Path $PSScriptRoot "../../.cache/task-scratch/visual-assets-restore-worker-$([guid]::NewGuid())"
)).FullName
$digests = @(foreach ($source in $Sample,$SecondSample) {
    $source = (Resolve-Path -LiteralPath $source).Path
    $digest = (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant()
    Copy-Item -LiteralPath $source -Destination (Join-Path $root "$digest.blob")
    $digest
})
if ($digests[0] -eq $digests[1]) { throw 'Use two distinct valid samples' }
$bad = Join-Path $root 'malformed'
[IO.File]::WriteAllText($bad, 'not an image')
$badDigest = (Get-FileHash -LiteralPath $bad).Hash.ToLowerInvariant()
Move-Item -LiteralPath $bad -Destination (Join-Path $root "$badDigest.blob")
$start = [Diagnostics.ProcessStartInfo]::new($Probe)
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.ArgumentList.Add('--zicode-visual-assets-restore-worker')
$start.ArgumentList.Add($root)
$process = [Diagnostics.Process]::Start($start)
$output = [IO.MemoryStream]::new()
try {
    $acknowledgements = $process.StandardOutput.BaseStream.CopyToAsync($output)
    $stderr = $process.StandardError.ReadToEndAsync()
    $requests = [Text.Encoding]::ASCII.GetBytes((($digests + $badDigest) -join [char]10) + [char]10)
    $process.StandardInput.BaseStream.Write($requests, 0, $requests.Length)
    $process.StandardInput.Close()
    if (!$process.WaitForExit(15000)) {
        $process.Kill()
        $process.WaitForExit()
        throw "Restore worker protocol verification timed out. Evidence: $root"
    }
    [void]$acknowledgements.GetAwaiter().GetResult()
    $failure = $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 1 -or [Convert]::ToHexString($output.ToArray()) -ne '0101' -or
        (Test-Path -LiteralPath (Join-Path $root "$badDigest.png"))) {
        throw "Worker did not complete two valid requests before rejecting the third. $failure. Evidence: $root"
    }
    foreach ($digest in $digests) {
        $thumbnail = [IO.File]::ReadAllBytes((Join-Path $root "$digest.png"))
        if ($thumbnail.Length -gt 512KB -or $thumbnail.Length -lt 33 -or
            [Convert]::ToHexString($thumbnail[0..7]) -ne '89504E470D0A1A0A' -or
            (Get-FileHash -LiteralPath (Join-Path $root "$digest.blob")).Hash -ne $digest) {
            throw "Worker produced an invalid result. Evidence: $root"
        }
    }
} finally {
    if (!$process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $output.Dispose()
    $process.Dispose()
}
Write-Output "Passed. Evidence directory: $root"
