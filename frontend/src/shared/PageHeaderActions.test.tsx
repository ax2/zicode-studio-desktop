import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PageHeaderActions } from "./PageHeaderActions";
afterEach(() => { cleanup(); document.getElementById("page-header-actions")?.remove(); });
it("portals controls into the shell and preserves the editor node across updates", () => {
  const slot = document.createElement("div"); slot.id = "page-header-actions"; document.body.append(slot);
  const view = render(<><PageHeaderActions owner="notes"><button type="button">Edit</button></PageHeaderActions><textarea defaultValue="unsaved" /></>);
  const editor = view.container.querySelector("textarea");
  expect(slot.querySelector("button")?.textContent).toBe("Edit");
  expect(view.container.querySelector("button")).toBeNull();
  view.rerender(<><PageHeaderActions owner="notes" locked><button type="button">Preview</button></PageHeaderActions><textarea defaultValue="unsaved" /></>);
  expect(view.container.querySelector("textarea")).toBe(editor);
  expect(slot.querySelector("[inert]")).toBeTruthy();
  view.unmount(); expect(slot.children.length).toBe(0);
});
