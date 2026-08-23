import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_TEMPLATES,
  allChatTemplates,
  createTemplateId,
  exportCustomTemplates,
  importCustomTemplates,
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

  it("round-trips an export payload through import", () => {
    saveCustomTemplates([
      { id: "custom-a", icon: "🔥", label: "Fire", prompt: "Do fire things" },
      { id: "custom-b", icon: "📝", label: "Notes", prompt: "Make notes" },
    ]);
    const payload = exportCustomTemplates();
    const parsed = JSON.parse(payload) as {
      version: number;
      templates: unknown[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.templates).toHaveLength(2);

    globalThis.localStorage?.removeItem(CUSTOM_KEY);
    const result = importCustomTemplates(payload);
    expect(result).toEqual({ added: 2, skipped: 0 });
    expect(loadCustomTemplates().map((template) => template.id)).toEqual([
      "custom-a",
      "custom-b",
    ]);
  });

  it("dedupes imports by id and skips malformed entries", () => {
    saveCustomTemplates([
      { id: "custom-a", icon: "🔥", label: "Fire", prompt: "Do fire things" },
    ]);
    const result = importCustomTemplates(
      JSON.stringify({
        version: 1,
        templates: [
          { id: "custom-a", label: "Fire", prompt: "Do fire things" },
          { id: "custom-b", icon: "", label: "  New  ", prompt: " p " },
          { label: "no prompt" },
          null,
        ],
      }),
    );
    expect(result).toEqual({ added: 1, skipped: 1 });
    expect(loadCustomTemplates()).toEqual([
      { id: "custom-a", icon: "🔥", label: "Fire", prompt: "Do fire things" },
      { id: "custom-b", icon: "📝", label: "New", prompt: "p" },
    ]);
  });

  it("accepts a bare array payload and rejects invalid JSON", () => {
    saveCustomTemplates([]);
    expect(
      importCustomTemplates(
        JSON.stringify([{ id: "x", label: "X", prompt: "XP" }]),
      ),
    ).toEqual({ added: 1, skipped: 0 });
    expect(
      importCustomTemplates(
        JSON.stringify([{ id: "x", label: "X", prompt: "XP" }]),
      ),
    ).toEqual({ added: 0, skipped: 1 });
    expect(
      importCustomTemplates(JSON.stringify({ templates: [] })),
    ).toEqual({ added: 0, skipped: 0 });
    expect(() => importCustomTemplates("not json")).toThrow();
  });
});
