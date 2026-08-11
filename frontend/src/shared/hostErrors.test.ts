import { describe, expect, it } from "vitest";
import { setLocale } from "./i18n.js";
import { isRuntimeProcessClosedError, localizeHostError } from "./hostErrors.js";

describe("host error localization", () => {
  it("recognizes runtime process-closed errors in every phrasing the host emits", () => {
    expect(isRuntimeProcessClosedError(new Error("Pi RPC request failed: ProcessClosed"))).toBe(
      true,
    );
    expect(isRuntimeProcessClosedError(new Error("process closed"))).toBe(true);
    expect(isRuntimeProcessClosedError("ProcessClosed")).toBe(true);
    expect(isRuntimeProcessClosedError(new Error("quota exceeded"))).toBe(false);
    expect(isRuntimeProcessClosedError("network unavailable")).toBe(false);
  });

  it("maps a closed runtime to the localized recovery message", () => {
    setLocale("zh-CN");
    const localized = localizeHostError(new Error("Pi RPC request failed: ProcessClosed"));
    expect(localized.message).toContain("Pi 运行时");
    expect(localized.message).toContain("新建一个会话");
  });

  it("leaves unrelated host errors untouched", () => {
    setLocale("zh-CN");
    const original = new Error("quota exceeded");
    expect(localizeHostError(original)).toBe(original);
    expect(localizeHostError("plain string").message).toBe("plain string");
  });
});
