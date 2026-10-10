import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginSidebarShell } from "./PluginSidebarShellApp";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("plugin sidebar shell", () => {
  it("opens the project workspace from the project row", () => {
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
    expect(row).toBeTruthy();
    row.click();
    window.removeEventListener("zicode:open-project", listener);
    expect(dispatched).toEqual(["zicode:open-project"]);
  });
});
