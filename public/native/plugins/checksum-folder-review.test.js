import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createChecksumFolderReview, validateChecksumFolder } from "./checksum-folder-review.js";

const sha = "a".repeat(64), other = "b".repeat(64), grantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const profile = "resource.local-directory.checksum.preview1";
const pluginId = "com.zicode.devtools.checksum-manifest", capabilityId = "devtools.checksum-manifest.review";
let controller;

function setup(report) {
  setLocale("en");
  const container = document.body;
  const manifest = report.map(({ name, expected }) => `${expected}  ${name}`).join("\r\n");
  const gateway = {
    checksumFolders: {
      prepare: vi.fn(async (_workspace, owner) => ({
        schemaVersion: 1, profile, grantId, owner, displayName: "素材", confirmed: false, entryNamesRead: false,
      })),
      commit: vi.fn(async () => ({ schemaVersion: 1, profile, entries: report })),
      cancel: vi.fn(async () => ({})),
    },
    searchTools: vi.fn(async () => ({ revision: other, items: [{ pluginId, capabilityId, enabled: true, runtime: "wasi", version: "0.2.0" }] })),
    callProtocol: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", prepareRequired: true })),
    loadTool: vi.fn(async () => ({ pluginId, capability: { id: capabilityId }, revision: other, version: "0.2.0" })),
    prepareCall: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId: grantId })),
    cancelCall: vi.fn(async () => ({})),
    invoke: vi.fn(async (_scene, _workspace, _plugin, _capability, input) => {
      const entries = input.manifest.split("\n").map(line => {
        const name = line.slice(66), expected = line.slice(0, 64);
        const actual = input.files.find(file => file.name === name)?.sha256;
        return { name, expected, status: actual === undefined ? "not_provided" : actual === expected ? "match" : "mismatch" };
      });
      return { result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: JSON.stringify({ schemaVersion: 1, entries }) } } };
    }),
  };
  controller = createChecksumFolderReview({ container, gateway,
    getTarget: () => ({ workspaceId: "w", instanceId: "runtime", sessionId: "session", sceneId: "programming" }),
    isCurrent: () => true, isBlocked: () => false, onBusy: vi.fn(),
  });
  const input = container.querySelector("textarea");
  input.value = manifest;
  input.dispatchEvent(new Event("input"));
  return { gateway, button: text => [...container.querySelectorAll("button")].find(element => element.textContent === text) };
}

afterEach(() => {
  controller?.destroy();
  controller = null;
  document.body.replaceChildren();
  setLocale("zh-CN");
});

it("confirms before reading a directory and checks all 64 entries through four bounded Worker calls", async () => {
  const report = Array.from({ length: 64 }, (_, index) => ({ name: `文件 ${index}.txt`, expected: sha, actual: sha, status: "match" }));
  Object.assign(report[1], { actual: other, status: "mismatch" });
  Object.assign(report[2], { actual: null, status: "missing" });
  Object.assign(report[3], { actual: null, status: "read_error" });
  const { gateway, button } = setup(report);
  button("Choose folder to verify").click();
  await vi.waitFor(() => expect(button("Confirm and verify folder").hidden).toBe(false));
  expect(gateway.checksumFolders.prepare.mock.calls[0][0]).toBe("w");
  expect(gateway.checksumFolders.commit).not.toHaveBeenCalled();
  expect(gateway.invoke).not.toHaveBeenCalled();
  button("Confirm and verify folder").click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Manifest review completed"));
  expect(gateway.invoke).toHaveBeenCalledTimes(4);
  expect(gateway.invoke.mock.calls[0][4].files).toHaveLength(14);
  expect(document.querySelectorAll("li")).toHaveLength(64);
  expect(document.body.textContent).toContain("File missing");
  expect(document.body.textContent).toContain("Could not read file");
});

it("discards a late Host response after cancellation and sends nothing to the Worker", async () => {
  const report = [{ name: "a.txt", expected: sha, actual: sha, status: "match" }];
  const { button, gateway } = setup(report);
  let resolveCommit;
  gateway.checksumFolders.commit.mockImplementation(() => new Promise(resolve => { resolveCommit = resolve; }));
  button("Choose folder to verify").click();
  await vi.waitFor(() => expect(button("Confirm and verify folder").hidden).toBe(false));
  button("Confirm and verify folder").click();
  button("Cancel").click();
  resolveCommit({ schemaVersion: 1, profile, entries: report });
  await vi.waitFor(() => expect(button("Choose folder to verify").disabled).toBe(false));
  expect(gateway.checksumFolders.cancel).toHaveBeenCalledOnce();
  expect(gateway.invoke).not.toHaveBeenCalled();
  expect(document.querySelectorAll("li")).toHaveLength(0);
});

it("rejects a changed filename or a verdict inconsistent with the Host digest", () => {
  const manifest = `${sha}  a.txt`;
  for (const row of [
    { name: "b.txt", expected: sha, actual: sha, status: "match" },
    { name: "a.txt", expected: sha, actual: other, status: "match" },
    { name: "a.txt", expected: sha, actual: null, status: "match" },
  ]) {
    expect(() => validateChecksumFolder({ schemaVersion: 1, profile, entries: [row] }, manifest)).toThrow();
  }
});
