// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const platform = readFileSync(
  new URL("../.github/workflows/developer-platform.yml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const release = readFileSync(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("release dependency cache reuse", () => {
  it("preserves the existing platform cache prefix and target directory", () => {
    const job = platform.match(/^  (\w+):\n    name: Platform checks/m)?.[1];
    const inputKey = platform.match(/^\s+key: (developer-platform-.*)$/m)?.[1];
    const sharedKey = release.match(/^\s+shared-key: (.*)$/m)?.[1];
    expect(job).toBe("platform");
    expect(sharedKey).toBe(`${inputKey}-${job}`);
    for (const workflow of [platform, release]) {
      expect(workflow).toContain('workspaces: "src-tauri -> ../target"');
      expect(workflow).toContain("cache-on-failure: true");
    }
  });

  it("keeps download retry settings out of the global compiler cache identity", () => {
    const globalSettings = release.split(/^jobs:/m)[0];
    expect(globalSettings).not.toContain("CARGO_HTTP_MULTIPLEXING");
    expect(globalSettings).not.toContain("CARGO_NET_RETRY");
    expect(release.match(/CARGO_HTTP_MULTIPLEXING: "false"/g)).toHaveLength(4);
    expect(release.match(/CARGO_NET_RETRY: "10"/g)).toHaveLength(4);
    expect(platform).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });
});
