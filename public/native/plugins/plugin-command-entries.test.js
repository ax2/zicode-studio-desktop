import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { pluginCommandEntries } from "./plugin-command-entries.js";

it("makes the real commandless text candidate searchable without invoking it", () => {
  const manifest = JSON.parse(
    readFileSync("tests/fixtures/devtools-text-dev57/plugin.json", "utf8"),
  );
  const plugin = {
    ...manifest.contributes,
    id: manifest.id,
    name: manifest.name,
    publisher: manifest.publisher,
    origin: "developer",
    enabled: true,
  };
  const openPlugin = vi.fn();
  const execute = vi.fn();
  const options = {
    isAvailable: () => true,
    translate: (text) => text,
    icon: () => "tool",
    isDisabled: () => false,
    openPlugin,
    execute,
  };
  const entries = pluginCommandEntries([plugin], options);
  expect(entries).toHaveLength(1);
  expect(entries[0].keywords).toContain("devtools.text.base64.encode");
  expect(entries[0].keywords).toContain(manifest.publisher);
  expect(execute).not.toHaveBeenCalled();
  entries[0].action();
  expect(openPlugin).toHaveBeenCalledWith(manifest.id);
  expect(execute).not.toHaveBeenCalled();
  expect(pluginCommandEntries([{ ...plugin, enabled: false }], options)).toHaveLength(0);
  expect(pluginCommandEntries([plugin], { ...options, isAvailable: () => false })).toHaveLength(0);
  expect(pluginCommandEntries([{ ...plugin, views: [] }], options)).toHaveLength(0);
});
