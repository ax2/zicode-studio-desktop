// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

it("bounds Windows harness concurrency while preserving explicit platform settings", () => {
  const platform = read("../.github/workflows/developer-platform.yml");
  expect(platform).toContain('elif [[ "$RUNNER_OS" == Windows ]]');
  expect(platform).toContain('RUST_TEST_THREADS="${RUST_TEST_THREADS:-2}" node scripts/developer-platform-checks.mjs');
  const release = read("../.github/workflows/release.yml");
  const windows = release.split("- name: Check Rust on Windows")[1].split("- name:")[0];
  expect(windows).toContain('RUST_TEST_THREADS: "2"');
  expect(windows).toContain("scripts/check-rust.sh");
  expect(read("./check-rust.sh")).toContain('cargo test --manifest-path "$MANIFEST"');
  expect(read("../src-tauri/src/project_environment/tests.rs")).toContain('tokio::time::timeout(Duration::from_secs(12)');
});
