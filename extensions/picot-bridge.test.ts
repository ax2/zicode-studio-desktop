// @vitest-environment node

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import picotBridge from "./picot-bridge";

vi.mock("./picot-config", () => ({
  handlePicotConfig: vi.fn(),
}));
vi.mock("./project-trust", () => ({
  default: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

function loadBridge() {
  const handlers = new Map<string, (event: Record<string, unknown>) => unknown>();
  const pi = {
    on: vi.fn(
      (event: string, handler: (value: Record<string, unknown>) => unknown) =>
        handlers.set(event, handler),
    ),
    registerCommand: vi.fn(),
  };
  picotBridge(pi as unknown as ExtensionAPI);
  return { handlers, pi };
}

describe("desktop scene policy", () => {
  it("adds the active scene prompt and blocks tools outside the allowlist", () => {
    vi.stubEnv("PI_DESKTOP_SCENE_PROMPT", "Use finance evidence rules.");
    vi.stubEnv("PI_DESKTOP_ALLOWED_TOOLS", '["read"]');
    const { handlers } = loadBridge();

    const promptResult = handlers.get("before_agent_start")?.({
      systemPrompt: "Base prompt",
    }) as { systemPrompt?: string };
    expect(promptResult.systemPrompt).toContain("Use finance evidence rules.");
    expect(handlers.get("tool_call")?.({ toolName: "read" })).toBeUndefined();
    expect(handlers.get("tool_call")?.({ toolName: "bash" })).toEqual({
      block: true,
      reason: 'Tool "bash" is disabled by the active desktop scene policy.',
    });
  });

  it("fails closed when an allowlist is malformed", () => {
    vi.stubEnv("PI_DESKTOP_ALLOWED_TOOLS", "not-json");
    const { handlers } = loadBridge();

    expect(handlers.get("tool_call")?.({ toolName: "read" })).toMatchObject({ block: true });
  });
});
