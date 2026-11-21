// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
