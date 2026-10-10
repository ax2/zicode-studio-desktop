import { expect, it, vi } from "vitest";
import { applicationDirectory, primaryActivities, PRIMARY_ACTIVITY_IDS } from "./tool-navigation.js";

it.each([10, 100, 1000])("keeps primary navigation constant for %i additional plugins", count => {
  const core = PRIMARY_ACTIVITY_IDS.filter(id => id !== "core.tools").map(id => ({ id, name: id, enabled: true }));
  const plugins = Array.from({ length: count }, (_, index) => ({ id: `fixture.${index}`, name: `Tool ${index}`, enabled: true,
    origin: "developer", views: [{ location: "main" }], capabilities: [{ id: `encode.${index}`, title: "Encode" }] }));
  const open = vi.fn();
  expect(primaryActivities([...core, ...plugins], () => true).map(plugin => plugin.id)).toEqual(PRIMARY_ACTIVITY_IDS);
  const entries = applicationDirectory([...core, ...plugins], () => true, text => text, open);
  expect(entries).toHaveLength(count + core.length);
  expect(entries.at(-1).keywords).toContain(`encode.${count - 1}`);
  expect(open).not.toHaveBeenCalled();
  entries.at(-1).action();
  expect(open).toHaveBeenCalledWith(`fixture.${count - 1}`);
});

it("filters disabled, unavailable and headless applications without loading providers", () => {
  const plugins = [
    { id: "disabled", enabled: false }, { id: "remote", enabled: true },
    { id: "headless", enabled: true, origin: "developer", views: [] },
    { id: "available", name: "Available", enabled: true, origin: "developer", views: [{ location: "main" }] },
  ];
  expect(applicationDirectory(plugins, plugin => plugin.id !== "remote", text => text, vi.fn()).map(entry => entry.id))
    .toEqual(["available:open"]);
});
