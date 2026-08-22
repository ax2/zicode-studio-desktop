import { describe, expect, it } from "vitest";
import { helpPageForPlugin } from "./pluginManagerLogic";

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
