import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginActivityBarApp } from "./PluginActivityBarApp";
import { createPluginShellBarStore } from "./pluginShellStore";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("plugin activity bar", () => {
  it("exposes keyboard shortcuts to assistive technology", () => {
    const store = createPluginShellBarStore();
    store.setState({
      activities: [
        { id: "core.chat", label: "Chat", icon: "chat" },
        { id: "com.zicode.projects", label: "Projects", icon: "projects" },
      ],
    });
    const { container } = render(
      <PluginActivityBarApp
        store={store}
        onActivate={() => {}}
        onSystemActivate={() => {}}
        onMoreClick={() => {}}
        onBackdropClick={() => {}}
        onMenuClose={() => {}}
        onMenuItemClick={() => {}}
      />,
    );
    const buttons = Array.from(
      container.querySelectorAll(".plugin-activity-button[data-plugin-id]"),
    );
    expect(buttons.map((button) => button.getAttribute("aria-keyshortcuts"))).toEqual([
      "Control+1",
      "Control+2",
    ]);
  });
});
