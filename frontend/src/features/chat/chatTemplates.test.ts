import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_TEMPLATES,
  allChatTemplates,
  createTemplateId,
  loadCustomTemplates,
  saveCustomTemplates,
} from "./chatTemplates";

const CUSTOM_KEY = "zicode-chat-templates-custom";

afterEach(() => {
  try {
    globalThis.localStorage?.removeItem(CUSTOM_KEY);
  } catch {
    // Best effort cleanup.
  }
});

describe("custom chat templates", () => {
  it("round-trips custom templates through localStorage", () => {
    saveCustomTemplates([
      { id: "custom-a", icon: "🔥", label: "Fire", prompt: "Do fire things" },
    ]);
    expect(loadCustomTemplates()).toEqual([
      { id: "custom-a", icon: "🔥", label: "Fire", prompt: "Do fire things" },
    ]);
    expect(allChatTemplates().map((template) => template.id)).toEqual([
      ...CHAT_TEMPLATES.map((template) => template.id),
      "custom-a",
    ]);
  });

  it("ignores malformed payloads and normalizes valid entries", () => {
    globalThis.localStorage?.setItem(CUSTOM_KEY, "not json");
    expect(loadCustomTemplates()).toEqual([]);

    globalThis.localStorage?.setItem(CUSTOM_KEY, JSON.stringify({ nope: true }));
    expect(loadCustomTemplates()).toEqual([]);

    globalThis.localStorage?.setItem(
      CUSTOM_KEY,
      JSON.stringify([
        { id: "x", label: "  A  ", prompt: " p ", icon: "" },
        { label: "no id" },
        null,
      ]),
    );
    expect(loadCustomTemplates()).toEqual([
      { id: "x", icon: "📝", label: "A", prompt: "p" },
    ]);
  });

  it("generates unique template ids", () => {
    const ids = new Set([
      createTemplateId(),
      createTemplateId(),
      createTemplateId(),
    ]);
    expect(ids.size).toBe(3);
  });
});
