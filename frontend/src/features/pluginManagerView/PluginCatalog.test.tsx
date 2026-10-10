import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PluginCatalog } from "./PluginCatalog";
import type { ManagedPlugin } from "./pluginManagerLogic";

afterEach(cleanup);
const plugins = Array.from({ length: 1000 }, (_, i) => ({ id: `tool-${i}`, name: `Tool ${i}`, description: "" }));
const card = (plugin: ManagedPlugin) => <article key={plugin.id}>{plugin.id}</article>;

it("reaches every item through bounded pages, clamps jumps and resets after a search remount", () => {
  const { container, rerender } = render(<PluginCatalog key="all" plugins={plugins} renderCard={card} empty="Empty" />);
  expect(container.querySelectorAll("article")).toHaveLength(40);
  const page = screen.getByRole("spinbutton");
  fireEvent.change(page, { target: { value: "25" } });
  fireEvent.keyDown(page, { key: "Enter" });
  expect(screen.getByText("tool-999")).toBeTruthy();
  expect((screen.getByRole("button", { name: /Next page|下一页/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(page, { target: { value: "999" } });
  fireEvent.blur(page);
  expect((page as HTMLInputElement).value).toBe("25");
  fireEvent.click(screen.getByRole("button", { name: /Previous page|上一页/ }));
  expect(screen.getByText("tool-920")).toBeTruthy();
  rerender(<PluginCatalog key="search" plugins={[plugins[999]]} renderCard={card} empty="Empty" />);
  expect(container.querySelectorAll("article")).toHaveLength(1);
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.getByText("tool-999")).toBeTruthy();
});

it("clamps a shrinking registry and leaves empty results accessible", () => {
  const { container, rerender } = render(<PluginCatalog plugins={plugins} renderCard={card} empty="Empty" />);
  const page = screen.getByRole("spinbutton");
  fireEvent.change(page, { target: { value: "25" } });
  fireEvent.keyDown(page, { key: "Enter" });
  rerender(<PluginCatalog plugins={plugins.slice(0, 41)} renderCard={card} empty="Empty" />);
  expect(container.querySelectorAll("article")).toHaveLength(1);
  expect(screen.getByText("tool-40")).toBeTruthy();
  rerender(<PluginCatalog plugins={[]} renderCard={card} empty="Empty" />);
  expect(screen.getByText("Empty")).toBeTruthy();
  expect(container.querySelectorAll("article")).toHaveLength(0);
});
