import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copy.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete document.execCommand;
});

describe("copyText", () => {
  it("uses the async Clipboard API when it resolves quickly", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the async API hangs (WebView2 case)", async () => {
    const writeText = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    await expect(copyText("fallback", { timeoutMs: 20 })).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when both paths fail", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => new Promise(() => {})) } });
    document.execCommand = vi.fn(() => false);
    await expect(copyText("nope", { timeoutMs: 20 })).resolves.toBe(false);
  });
});
