import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "../i18n.js";

const modelServiceError =
  "The model service was unreachable and the run produced no output. Please retry.";

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
    expect(appJs).toContain(modelServiceError);
  });

  it("keeps the friendly message in the zh-CN dictionary", () => {
    expect(t(modelServiceError, "zh-CN")).toBe("模型服务不可用，本轮未产出内容，请重试。");
  });
});
