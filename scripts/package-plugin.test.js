import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zicode-package-script-"));
  roots.push(root);
  const plugin = join(root, "plugin");
  mkdirSync(plugin);
  writeFileSync(
    join(plugin, "plugin.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "com.example.package-script",
      name: "Package Script",
      description: "Fixture",
      version: "1.0.0",
      publisher: "Example Publisher",
      engines: { pluginApi: "^1.0.0" },
      contributes: {},
      permissions: { required: [], optional: [] },
    }),
  );
  writeFileSync(join(plugin, "worker.js"), "zicode.capabilities.register('demo', () => ({}));");
  const { privateKey } = generateKeyPairSync("ed25519");
  const key = join(root, "publisher.pem");
  writeFileSync(key, privateKey.export({ format: "pem", type: "pkcs8" }));
  return { key, plugin, root };
}

describe("package-plugin", () => {
  it("creates a deterministic signed package manifest without embedding the private key", () => {
    const { key, plugin, root } = fixture();
    const output = join(root, "example.zicode-plugin");
    const result = spawnSync(
      "bun",
      ["run", "scripts/package-plugin.js", plugin, "--key", key, "--out", output],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const archive = unzipSync(readFileSync(output));
    const packageManifest = JSON.parse(new TextDecoder().decode(archive["package.json"]));
    expect(packageManifest.publisher.keyId).toMatch(/^[a-f0-9]{64}$/);
    expect(packageManifest.signature).toBeTruthy();
    expect(packageManifest.files.map((file) => file.path)).toEqual(["plugin.json", "worker.js"]);
    expect(Object.keys(archive)).not.toContain("publisher.pem");
  });

  it("rejects environment files", () => {
    const { key, plugin, root } = fixture();
    writeFileSync(join(plugin, ".env"), "SECRET=not-for-packaging");
    const result = spawnSync(
      "bun",
      [
        "run",
        "scripts/package-plugin.js",
        plugin,
        "--key",
        key,
        "--out",
        join(root, "bad.zicode-plugin"),
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Sensitive or generated file");
  });

  it("rejects a file that would replace the signed package manifest", () => {
    const { key, plugin, root } = fixture();
    writeFileSync(join(plugin, "package.json"), "{}");
    const result = spawnSync(
      "bun",
      ["run", "scripts/package-plugin.js", plugin, "--key", key, "--out", join(root, "bad.zicode-plugin")],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid package path: package.json");
  });
});
