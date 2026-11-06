import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginSidebarShell } from "./PluginSidebarShellApp";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("plugin sidebar shell", () => {
  it("omits the project row and its navigation action in the default desktop", () => {
    const dispatched: string[] = [];
    const listener = (event: Event) => dispatched.push(event.type);
    window.addEventListener("zicode:open-project", listener);
    const { container } = render(
      <PluginSidebarShell
        title="Settings"
        accordions={[]}
        project={{ name: "ax2", path: "C:/Users/ax2" }}
      />,
    );
    const row = container.querySelector(".plugin-sidebar-project") as HTMLElement;
    expect(row).toBeNull();
    expect(container.textContent).not.toContain("C:/Users/ax2");
    window.removeEventListener("zicode:open-project", listener);
    expect(dispatched).toEqual([]);
  });
});
