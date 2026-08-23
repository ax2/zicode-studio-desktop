import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("model error mapping contract", () => {
  it("maps transient model-gateway failures to a friendly retry message", () => {
    const appJs = readFileSync(
      join(process.cwd(), "public", "native", "app.js"),
      "utf8",
    );
    expect(appJs).toContain("friendlyDispatchedRunError");
    expect(appJs).toMatch(
      /model\[_ \]gateway\[_ \]unreachable\|502/i,
    );
    expect(appJs).toContain(
      "The model service was unreachable and the run produced no output. Please retry.",
    );
  });

  it("keeps the friendly message in the zh-CN dictionary", () => {
    const i18n = readFileSync(
      join(process.cwd(), "public", "i18n.js"),
      "utf8",
    );
    expect(i18n).toContain("模型服务不可用，本轮未产出内容，请重试。");
  });
});
