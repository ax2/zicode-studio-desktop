// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import staging from "./stage-local-resources.js";

it("replaces same-size stale files beside the EXE and reuses matching prepared resources", async () => {
  const root = mkdtempSync(join(tmpdir(), "studio-local-resources-"));
  try {
    const debug = join(root, "debug");
    for (const dir of ["ui","debug/public","debug/build/public"]) mkdirSync(join(root,dir),{recursive:true});
    const live = join(debug,"public/mail.js");
    const prepared = join(debug,"build/public/mail.js");
    writeFileSync(join(root,"ui/mail.js"), "new");
    writeFileSync(prepared, "new");
    writeFileSync(live, "old");
    expect(await staging.stageLocalResources(root,debug,{ui:"public"})).toBe(1);
    expect(readFileSync(live,"utf8")).toBe("new");
    expect(statSync(live,{bigint:true}).ino).toBe(statSync(prepared,{bigint:true}).ino);
    expect(await staging.stageLocalResources(root,debug,{ui:"public"})).toBe(0);
    writeFileSync(join(root,"ui/mail.js"),"latest");
    expect(await staging.stageLocalResources(root,debug,{ui:"public"})).toBe(1);
    expect(readFileSync(live,"utf8")).toBe("latest");
    expect(readFileSync(prepared,"utf8")).toBe("new");
  } finally {
    rmSync(root,{recursive:true,force:true});
  }
});


async function withLinkedCheckout(test) {
  const root = mkdtempSync(join(tmpdir(), "studio-runtime-worktree-"));
  try {
    const primary = join(root, "primary");
    const linked = join(root, "parallel checkout");
    mkdirSync(primary);
    const git = (...args) => execFileSync("git", args, { cwd: primary, stdio: "ignore", windowsHide: true });
    git("init", "--quiet");
    git("-c", "user.name=Runtime test", "-c", "user.email=runtime@example.invalid",
      "-c", `core.hooksPath=${join(root, "no-hooks")}`,
      "commit", "--allow-empty", "--no-gpg-sign", "--quiet", "-m", "Fixture");
    git("worktree", "add", "--quiet", "--detach", linked);
    const shared = join(primary, "src-tauri", "resources");
    const config = join(linked, "src-tauri");
    mkdirSync(shared, { recursive: true });
    mkdirSync(join(config, "resources"), { recursive: true });
    await test({ root, shared, config, debug: join(root, "debug") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function linkRuntime(target, link) {
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

it("stages the primary checkout's shared runtimes without linking the runnable copy to the source", async () => {
  await withLinkedCheckout(async ({ shared, config, debug }) => {
    const resources = {};
    for (const name of ["pi", "portable-git", "webview2", "bun"]) {
      const directory = join(shared, name);
      mkdirSync(directory);
      writeFileSync(join(directory, "runtime.bin"), name);
      linkRuntime(directory, join(config, "resources", name));
      resources[`./resources/${name}`] = name;
    }
    expect(await staging.stageLocalResources(config, debug, resources)).toBe(4);
    expect(await staging.stageLocalResources(config, debug, resources)).toBe(0);
    const live = join(debug, "pi", "runtime.bin");
    writeFileSync(join(shared, "pi", "runtime.bin"), "updated");
    expect(readFileSync(live, "utf8")).toBe("pi");
    expect(await staging.stageLocalResources(config, debug, resources)).toBe(1);
    expect(readFileSync(live, "utf8")).toBe("updated");
  });
});

it("recognizes a linked checkout recorded through an alternate directory path", async () => {
  await withLinkedCheckout(async ({ root, shared, config, debug }) => {
    const checkout = dirname(config);
    const alias = join(root, "alternate checkout path");
    linkRuntime(checkout, alias);
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: checkout, encoding: "utf8", windowsHide: true,
    }).trim();
    const aliasedGitFile = join(alias, ".git").replaceAll("\\", "/");
    writeFileSync(join(gitDir, "gitdir"), aliasedGitFile + "\n");

    const bun = join(shared, "bun");
    mkdirSync(bun);
    writeFileSync(join(bun, "runtime.bin"), "shared runtime");
    linkRuntime(bun, join(config, "resources", "bun"));
    expect(await staging.stageLocalResources(config, debug, { "./resources/bun": "bun" })).toBe(1);
    expect(readFileSync(join(debug, "bun", "runtime.bin"), "utf8")).toBe("shared runtime");
  });
});

it("rejects external runtime targets, linked frontend roots, and nested links", async () => {
  await withLinkedCheckout(async ({ root, shared, config, debug }) => {
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "private.txt"), "fixture");
    linkRuntime(outside, join(config, "resources", "bun"));
    await expect(staging.stageLocalResources(config, debug, { "./resources/bun": "bun" }))
      .rejects.toThrow("corresponding primary checkout directory");

    linkRuntime(outside, join(config, "..", "public"));
    await expect(staging.stageLocalResources(config, debug, { "../public": "public" }))
      .rejects.toThrow("Expected a regular resource file");

    const pi = join(shared, "pi");
    mkdirSync(pi);
    linkRuntime(outside, join(pi, "nested"));
    linkRuntime(pi, join(config, "resources", "pi"));
    await expect(staging.stageLocalResources(config, debug, { "./resources/pi": "pi" }))
      .rejects.toThrow("Expected a regular resource file");
    expect(existsSync(join(debug, "pi", "nested", "private.txt"))).toBe(false);
  });
});

it("repairs missing and same-size changed files across resource batches", async () => {
  const root = mkdtempSync(join(tmpdir(), "studio-resource-batches-"));
  try {
    const debug = join(root, "debug");
    const ui = join(root, "ui");
    const output = join(debug, "public");
    mkdirSync(ui);
    mkdirSync(output, { recursive: true });
    for (let index = 0; index < 20; index++) {
      const name = `${String(index).padStart(2, "0")}.bin`;
      const source = join(ui, name);
      const target = join(output, name);
      const bytes = index === 17 ? Buffer.alloc(1024 * 1024 + 13, 65) : Buffer.from(name);
      writeFileSync(source, bytes);
      if (index === 18) continue;
      if (index === 17) bytes[bytes.length - 1] = 66;
      writeFileSync(target, bytes);
      const time = new Date("2026-01-01T00:00:00Z");
      utimesSync(source, time, time);
      utimesSync(target, time, time);
    }
    expect(await staging.stageLocalResources(root, debug, { ui: "public" })).toBe(2);
    expect(readFileSync(join(output, "17.bin"))).toEqual(readFileSync(join(ui, "17.bin")));
    expect(readFileSync(join(output, "18.bin"), "utf8")).toBe("18.bin");
    expect(await staging.stageLocalResources(root, debug, { ui: "public" })).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
