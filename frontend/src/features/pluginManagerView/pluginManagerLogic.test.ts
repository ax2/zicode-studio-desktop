import { describe, expect, it } from "vitest";
import { friendlyPluginError, helpPageForPlugin } from "./pluginManagerLogic";

describe("helpPageForPlugin", () => {
  it("maps utility plugins to their dedicated help pages", () => {
    expect(helpPageForPlugin("com.zicode.ocr")).toBe("ocr");
    expect(helpPageForPlugin("com.zicode.watch")).toBe("watch");
    expect(helpPageForPlugin("com.zicode.habits")).toBe("habits");
    expect(helpPageForPlugin("com.zicode.notes")).toBe("notes");
    expect(helpPageForPlugin("com.zicode.translate")).toBe("translate");
  });

  it("returns null for plugins without a help page", () => {
    expect(helpPageForPlugin("com.zicode.unknown")).toBeNull();
  });
});

describe("friendlyPluginError", () => {
  it("maps raw Rust plugin package errors to friendly localized messages", () => {
    expect(
      friendlyPluginError(
        new Error("Signed plugin package must use the .zicode-plugin extension"),
      ),
    ).toMatch(/Choose a \.zicode-plugin package file|请选择 \.zicode-plugin 插件包文件/);
    expect(
      friendlyPluginError(new Error("Signed plugin package is not a valid ZIP archive")),
    ).toMatch(/damaged or incomplete|已损坏或不完整/);
    expect(
      friendlyPluginError(
        new Error("Plugin publisher does not match the signed publisher"),
      ),
    ).toMatch(/not valid for this app|插件包无效/);
    expect(friendlyPluginError(new Error("Some other failure"))).toBe(
      "Some other failure",
    );
  });
});
