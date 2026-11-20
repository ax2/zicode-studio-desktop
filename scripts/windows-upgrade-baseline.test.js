// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32")(
  "chooses a strictly older public installer and fails closed for official upgrades",
  () => {
    const root = mkdtempSync(join(tmpdir(), "studio-baseline-"));
    try {
      const check = join(root, "check.ps1");
      writeFileSync(
        check,
        `
$ErrorActionPreference = 'Stop'
$workflow = Get-Content .github/workflows/release.yml -Raw
$start = $workflow.IndexOf('          $candidate = [version]')
$end = $workflow.IndexOf('          & "$env:RUNNER_TEMP/studio-release-verifier/verify-windows', $start)
$select = [scriptblock]::Create($workflow.Substring($start, $end-$start))
$env:RUNNER_TEMP = $PSScriptRoot
function curl.exe {
  $script:url = $args[-1]
  $global:LASTEXITCODE = $script:downloadStatus
}
function Select-Baseline($tag, $publish, $status) {
  $env:RELEASE_TAG = $tag
  $env:PUBLISHING = $publish
  $script:downloadStatus = $status
  $script:url = ''
  . $select
  return @{ url=$script:url; required=$argsForBaseline.RequireUpgrade; digest=$argsForBaseline.PreviousSha256 }
}
$env:GITHUB_ACTIONS = 'true'
$env:STUDIO_RUNNER_ENVIRONMENT = 'github-hosted'
$env:RUNNER_OS = 'Windows'
Remove-Item Env:GH_TOKEN,Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
$verifier = Get-Content scripts/verify-windows-installer-runtime.ps1 -Raw
# Exercise only the receipt/validation prefix. Never run any installer or process guard.
$validate = [scriptblock]::Create($verifier.Substring(0,$verifier.IndexOf('Add-Type @')))
$candidatePath = Join-Path $PSScriptRoot 'candidate.txt'
$receipt = Join-Path $PSScriptRoot 'receipt.json'
[IO.File]::WriteAllText($candidatePath, 'synthetic; never executed')
$matrix = @(
  (Select-Baseline v0.7.0 'true' 0)
  (Select-Baseline v0.6.9 'true' 0)
  (Select-Baseline v0.6.9-rc.1 'false' 22)
  (Select-Baseline v0.6.8 'true' 0)
  (Select-Baseline v0.6.8 'true' 22)
  (Select-Baseline v0.6.8 'false' 22)
  (Select-Baseline v0.6.7 'true' 0)
  (Select-Baseline v0.6.2 'true' 0)
)
$failed = $false
try { & $validate -Installer $candidatePath -Version '0.6.8' -Receipt $receipt -RequireUpgrade }
catch { $failed = $_.Exception.Message -eq 'A verified previous installer is required for publication' }
$strict = Get-Content $receipt -Raw | ConvertFrom-Json
& $validate -Installer $candidatePath -Version '0.6.8' -Receipt $receipt
$diagnostic = Get-Content $receipt -Raw | ConvertFrom-Json
$badDigest = $false
try { & $validate -Installer $candidatePath -Version '0.6.8' -Receipt $receipt -PreviousInstaller $candidatePath -PreviousSha256 ('0'*64) -RequireUpgrade }
catch { $badDigest = $_.Exception.Message -eq 'Unverified or identical upgrade baseline' }
@{matrix=$matrix; failed=$failed; strict=$strict.cases.baselineInstall.status; diagnostic=$diagnostic.cases.upgradeAndData.status; badDigest=$badDigest} | ConvertTo-Json -Depth 5 -Compress
`,
      );
      const output = execFileSync("pwsh", ["-NoProfile", "-File", check], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        encoding: "utf8",
      });
      const result = JSON.parse(output.trim().split("\n").at(-1));
      const current =
        "https://github.com/ax2/zicode-studio-desktop/releases/download/v0.6.7/ZiCode.Studio.Desktop_0.6.7_x64-setup.exe";
      const historical = current.replaceAll("0.6.7", "0.6.2");
      const latest = current.replaceAll("0.6.7", "0.6.8");
      expect(result.matrix).toEqual([
        {
          url: current.replaceAll("0.6.7", "0.6.9"),
          required: true,
          digest: "799dc8822ceb94a582c13d56de922b73cb611a949e6d70839dc36419112692ff",
        },
        {
          url: latest,
          required: true,
          digest: "c87460f36705d7f95e4959a9d70c3672498b8e7c44e66023e6b1d0b3d1f8032f",
        },
        { url: latest, required: false, digest: null },
        {
          url: current,
          required: true,
          digest: "a1cee55fc1c30eb803257a5431b26a6a4031618756ffacbad206c6777369ef47",
        },
        { url: current, required: true, digest: null },
        { url: current, required: false, digest: null },
        {
          url: historical,
          required: false,
          digest: "e6f18ac3d4de6dfab123755ff75cb3ca7cd6486ed4a11619c5269d8760abdb9c",
        },
        { url: "", required: false, digest: null },
      ]);
      expect(result).toMatchObject({
        failed: true,
        strict: "failed",
        diagnostic: "skipped",
        badDigest: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
