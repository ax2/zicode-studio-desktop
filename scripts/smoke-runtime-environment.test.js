// @vitest-environment node
import { expect, it } from "vitest";
import { smokeRuntimeEnvironment } from "./smoke-runtime-environment.js";

it("keeps system startup variables and replaces personal configuration locations", () => {
  const source = { Path: "system-tools", SystemRoot: "windows", TEMP: "scratch",
    HOME: "personal-home", USERPROFILE: "personal-profile", PI_CODING_AGENT_DIR: "personal-agent",
    QVERIS_API_KEY: "fixture-only", OPENAI_API_KEY: "fixture-only", PI_DESKTOP_PLUGIN_BROKER_TOKEN: "fixture-only",
    HTTP_PROXY: "fixture-proxy", NODE_OPTIONS: "fixture-options" };
  expect(smokeRuntimeEnvironment("isolated", source)).toEqual({
    Path: "system-tools", SystemRoot: "windows", TEMP: "scratch", HOME: "isolated",
    USERPROFILE: "isolated", PI_CODING_AGENT_DIR: "isolated",
  });
  expect(source.HOME).toBe("personal-home");
});

it("does not inherit unrelated variables when the system environment is empty", () => {
  expect(smokeRuntimeEnvironment("isolated", {})).toEqual({ HOME: "isolated",
    USERPROFILE: "isolated", PI_CODING_AGENT_DIR: "isolated" });
});
