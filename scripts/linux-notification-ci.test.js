// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const wrapper = read("./with-linux-notifications.sh");

it("starts a real notification service and verifies D-Bus readiness before checking", () => {
  expect(wrapper).toContain('dunst -conf - </dev/null >"$notification_log" 2>&1 &');
  expect(wrapper).toContain("--dest org.freedesktop.Notifications");
  expect(wrapper).toContain("org.freedesktop.Notifications.GetServerInformation");
  expect(wrapper).toContain("attempt < 50");
  expect(wrapper).toContain('if [[ "$ready" != 1 ]]');
  expect(wrapper).toContain('kill "$notification_pid"');
  expect(wrapper).toContain('wait "$notification_pid"');
  expect(wrapper).toContain('"$@"');
  expect(wrapper).toContain("set -euo pipefail");
});

it("uses an isolated real desktop session in platform and release Rust checks", () => {
  for (const path of ["../.github/workflows/developer-platform.yml", "../.github/workflows/release.yml"]) {
    const workflow = read(path);
    expect(workflow).toContain("dunst xvfb dbus-x11");
    expect(workflow).toContain('if [[ "$RUNNER_OS" == Linux ]]');
    expect(workflow).toContain("xvfb-run -a dbus-run-session -- bash scripts/with-linux-notifications.sh");
  }
});
