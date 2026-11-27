// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectBundles, stageBundles } from "./release-candidate-files.mjs";

const roots = [];
const config = {
  tag: "v0.6.7-rc.1",
  version: "0.6.7-20001",
  sha: "a".repeat(40),
  platform: "windows",
};
const name = "ZiCode.Studio.Desktop_0.6.7-20001_x64-setup.exe";
afterEach(async () => {
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "studio-receipt-"));
  roots.push(dir);
  const input = join(dir, "input"),
    part = join(input, "verified-bundles-windows-x64");
  await mkdir(input);
  const file = join(dir, name.replaceAll("ZiCode.Studio.Desktop", "ZiCode Studio Desktop"));
  const bytes = Buffer.from([1, 2, 3, 255]);
  await writeFile(file, bytes);
  const acceptance = {
    schemaVersion: 1,
    version: "0.6.7-rc.1",
    installerSha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    installerBytes: bytes.length,
    cases: { cleanInstall: { status: "passed" }, upgradeAndData: { status: "passed" } },
  };
  return {
    part,
    file,
    acceptance,
    stage: (installerAcceptance = acceptance) =>
      stageBundles([file], part, { ...config, target: "windows-x64", installerAcceptance }),
    collect: (opts = {}) => collectBundles(input, join(dir, "output"), { ...config, ...opts }),
  };
}
it("preserves exact candidate bytes and accepts a tagged release with its encoded bundle version", async () => {
  const { part, collect, stage } = await setup();
  await stage();
  const [asset] = await collect();
  expect(asset.name).toBe(name);
  expect(asset.size).toBe(4);
  expect(await readFile(join(part, name))).toEqual(Buffer.from([1, 2, 3, 255]));
});
it.each([
  "same-size tampering",
  "extra attachment",
  "wrong frozen commit",
  "wrong version",
  "missing platform",
  "path traversal",
])("rejects %s", async (problem) => {
  const { part, collect, stage } = await setup(),
    opts = {};
  await stage();
  if (problem === "same-size tampering")
    await writeFile(join(part, name), Buffer.from([1, 2, 4, 255]));
  if (problem === "extra attachment") await writeFile(join(part, "extra.zip"), "unreviewed");
  if (problem === "wrong frozen commit") opts.sha = "b".repeat(40);
  if (problem === "wrong version") opts.version = "0.6.8";
  if (problem === "missing platform") opts.platform = "all";
  if (problem === "path traversal") {
    const path = join(part, "receipt.json"),
      receipt = JSON.parse(await readFile(path));
    receipt.entries[0].name = `../${name}`;
    await writeFile(path, JSON.stringify(receipt));
  }
  await expect(collect(opts)).rejects.toThrow();
});

it("refuses to stage a same-length replacement without a matching installer acceptance receipt", async () => {
  const { file, part, stage } = await setup();
  await writeFile(file, Buffer.from([1, 2, 4, 255]));
  await expect(stage()).rejects.toThrow("differs from Windows installer acceptance");
  await expect(readFile(join(part, "receipt.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  "missing",
  "version mismatch",
  "wrong size",
  "unfinished upgrade",
])("refuses installer acceptance that is %s", async (problem) => {
  const { acceptance, stage } = await setup();
  if (problem === "missing")
    return expect(stage(null)).rejects.toThrow("Invalid Windows installer acceptance");
  if (problem === "version mismatch") acceptance.version = "0.6.6";
  if (problem === "wrong size") acceptance.installerBytes = 3;
  if (problem === "unfinished upgrade") acceptance.cases.upgradeAndData.status = "notRun";
  await expect(stage(acceptance)).rejects.toThrow("Windows installer acceptance");
});
