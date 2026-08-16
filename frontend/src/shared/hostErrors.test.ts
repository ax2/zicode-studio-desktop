import { describe, expect, it } from "vitest";
import { setLocale } from "./i18n.js";
import {
  friendlyPluginError,
  isRuntimeProcessClosedError,
  localizeHostError,
} from "./hostErrors.js";

describe("host error localization", () => {
  it("recognizes runtime process-closed errors in every phrasing the host emits", () => {
    expect(isRuntimeProcessClosedError(new Error("Pi RPC request failed: ProcessClosed"))).toBe(
      true,
    );
    expect(isRuntimeProcessClosedError(new Error("process closed"))).toBe(true);
    expect(isRuntimeProcessClosedError("ProcessClosed")).toBe(true);
    expect(
      isRuntimeProcessClosedError(
        new Error("ZiCode Studio Desktop Host runtime is disconnected"),
      ),
    ).toBe(true);
    expect(isRuntimeProcessClosedError(new Error("Runtime adapter is disconnected"))).toBe(true);
    expect(
      isRuntimeProcessClosedError(
        new Error("This ZiCode Studio Desktop runtime is stopped or unavailable"),
      ),
    ).toBe(true);
    expect(
      isRuntimeProcessClosedError(
        new Error("The runtime that owns this broker token is no longer active"),
      ),
    ).toBe(true);
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

  it("maps common plugin backend errors to friendly messages", () => {
    setLocale("zh-CN");
    expect(friendlyPluginError(new Error("Cannot decode image: bad data"))).toBe(
      "无法解码该文件。",
    );
    expect(friendlyPluginError(new Error("Unsupported document type"))).toBe(
      "不支持此文件类型。",
    );
    expect(friendlyPluginError(new Error("Image exceeds the 10 MiB limit"))).toBe(
      "文件过大。",
    );
    expect(friendlyPluginError(new Error("Unknown template: xyz"))).toBe(
      "所选选项不可用。",
    );
    expect(friendlyPluginError(new Error("Cannot open image /tmp/a.png"))).toBe(
      "无法读取该文件。",
    );
    expect(
      friendlyPluginError(new Error("No text was recognized in the image")),
    ).toBe("未在图片中识别到文字");
    expect(
      friendlyPluginError(new Error("Cannot extract PDF text: bad stream")),
    ).toBe("无法读取该文件。");
    expect(friendlyPluginError(new Error("Cannot save image: disk full"))).toBe(
      "操作无法完成。",
    );
    expect(friendlyPluginError(new Error("some other failure"))).toBe("some other failure");
  });

  it("maps web-watch, translation and missing-record backend errors", () => {
    setLocale("zh-CN");
    expect(
      friendlyPluginError(new Error("URL host resolves to a private address 127.0.0.1")),
    ).toBe("该网址无效或无法访问。");
    expect(friendlyPluginError(new Error("Only http and https URLs are supported"))).toBe(
      "该网址无效或无法访问。",
    );
    expect(friendlyPluginError(new Error("Page is unreachable: connection refused"))).toBe(
      "无法访问该网页。",
    );
    expect(
      friendlyPluginError(new Error("Translation model key is not configured for this scene")),
    ).toBe("当前场景尚未配置翻译模型。");
    expect(friendlyPluginError(new Error("Model gateway is unreachable: timeout"))).toBe(
      "无法连接翻译服务，请检查网络或代理设置。",
    );
    expect(friendlyPluginError(new Error("Cannot retrieve the web page"))).toBe(
      "无法访问该网页，请检查网络或代理设置。",
    );
    expect(
      friendlyPluginError(new Error("Loopback and private network URLs are not allowed")),
    ).toBe("该网址不允许采集，本机与内网地址不可访问。");
    expect(friendlyPluginError(new Error("Enter a valid HTTP(S) URL"))).toBe(
      "该网址无效或无法访问。",
    );
    expect(
      friendlyPluginError(new Error("Text exceeds the 50000 character translation limit")),
    ).toBe("文本过长。");
    expect(friendlyPluginError(new Error("Watcher not found"))).toBe("找不到该条目。");
    expect(friendlyPluginError(new Error("Habit not found"))).toBe("找不到该条目。");
  });
});
