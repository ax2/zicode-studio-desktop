// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import staging from "./stage-local-resources.js";

it("replaces same-size stale files beside the EXE and reuses matching prepared resources", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-local-resources-"));
  try {
    const debug = join(root, "debug");
    for (const dir of ["ui","debug/public","debug/build/public"]) mkdirSync(join(root,dir),{recursive:true});
    const live = join(debug,"public/mail.js");
    const prepared = join(debug,"build/public/mail.js");
    writeFileSync(join(root,"ui/mail.js"), "new");
    writeFileSync(prepared, "new");
    writeFileSync(live, "old");
    expect(staging.stageLocalResources(root,debug,{ui:"public"})).toBe(1);
    expect(readFileSync(live,"utf8")).toBe("new");
    expect(statSync(live,{bigint:true}).ino).toBe(statSync(prepared,{bigint:true}).ino);
    expect(staging.stageLocalResources(root,debug,{ui:"public"})).toBe(0);
    writeFileSync(join(root,"ui/mail.js"),"latest");
    expect(staging.stageLocalResources(root,debug,{ui:"public"})).toBe(1);
    expect(readFileSync(live,"utf8")).toBe("latest");
    expect(readFileSync(prepared,"utf8")).toBe("new");
  } finally {
    rmSync(root,{recursive:true,force:true});
  }
});


function withLinkedCheckout(test) {
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
    test({ root, shared, config, debug: join(root, "debug") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function linkRuntime(target, link) {
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

it("stages the primary checkout's shared runtimes without linking the runnable copy to the source", () => {
  withLinkedCheckout(({ shared, config, debug }) => {
    const resources = {};
    for (const name of ["pi", "portable-git", "webview2", "bun"]) {
      const directory = join(shared, name);
      mkdirSync(directory);
      writeFileSync(join(directory, "runtime.bin"), name);
      linkRuntime(directory, join(config, "resources", name));
      resources[`./resources/${name}`] = name;
    }
    expect(staging.stageLocalResources(config, debug, resources)).toBe(4);
    expect(staging.stageLocalResources(config, debug, resources)).toBe(0);
    const live = join(debug, "pi", "runtime.bin");
    writeFileSync(join(shared, "pi", "runtime.bin"), "updated");
    expect(readFileSync(live, "utf8")).toBe("pi");
    expect(staging.stageLocalResources(config, debug, resources)).toBe(1);
    expect(readFileSync(live, "utf8")).toBe("updated");
  });
});

it("rejects external runtime targets, linked frontend roots, and nested links", () => {
  withLinkedCheckout(({ root, shared, config, debug }) => {
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "private.txt"), "fixture");
    linkRuntime(outside, join(config, "resources", "bun"));
    expect(() => staging.stageLocalResources(config, debug, { "./resources/bun": "bun" }))
      .toThrow("corresponding primary checkout directory");

    linkRuntime(outside, join(config, "..", "public"));
    expect(() => staging.stageLocalResources(config, debug, { "../public": "public" }))
      .toThrow("Expected a regular resource file");

    const pi = join(shared, "pi");
    mkdirSync(pi);
    linkRuntime(outside, join(pi, "nested"));
    linkRuntime(pi, join(config, "resources", "pi"));
    expect(() => staging.stageLocalResources(config, debug, { "./resources/pi": "pi" }))
      .toThrow("Expected a regular resource file");
    expect(existsSync(join(debug, "pi", "nested", "private.txt"))).toBe(false);
  });
});
