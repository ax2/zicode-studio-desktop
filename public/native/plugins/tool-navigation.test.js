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

it("lists disabled external views without opening them and filters unavailable or headless applications", () => {
  const plugins = [
    { id: "disabled", name: "Disabled", enabled: false, origin: "developer", views: [{ location: "main" }] },
    { id: "disabled-core", enabled: false }, { id: "remote", enabled: true },
    { id: "headless", enabled: true, origin: "developer", views: [] },
    { id: "available", name: "Available", enabled: true, origin: "developer", views: [{ location: "main" }] },
  ];
  const entries = applicationDirectory(plugins, plugin => plugin.id !== "remote", text => text, vi.fn());
  expect(entries.map(entry => entry.id)).toEqual(["disabled:open", "available:open"]);
  expect(entries[0].disabled).toBe(true);
  expect(entries[0].action).toBeUndefined();
  expect(entries[1].disabled).toBe(false);
});

it("classifies a View application from validated directory metadata without adding a sidebar icon", () => {
  const plugin = { id: "com.example.actuator", name: "Actuator", description: "Default description",
    enabled: true, origin: "developer", views: [{ location: "main" }],
    appDirectory: { categoryId: "system", aliases: ["Spring health"], description: "Read service health" } };
  expect(primaryActivities([plugin], () => true).map(item => item.id)).toEqual(["core.tools"]);
  const [entry] = applicationDirectory([plugin], () => true, text => text, vi.fn());
  expect(entry).toMatchObject({ id: "com.example.actuator:open", category: "System tools",
    desc: "Read service health" });
  expect(entry.keywords).toContain("Spring health");
});
