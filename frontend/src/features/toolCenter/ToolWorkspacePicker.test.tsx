import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ToolWorkspacePicker } from "./ToolWorkspacePicker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); });

it("loads projects on opening and switches only after an explicit choice", async () => {
  setLocale("en");
  const api = {
    list: vi.fn(async () => [{ id: "one", path: "C:\\Projects\\One" }, { id: "two", path: "C:\\Projects\\Two" }]),
    switchTo: vi.fn(async (_path: string) => {}),
    openFolder: vi.fn(async () => {}),
  };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ToolWorkspacePicker api={api} currentWorkspaceId="one" />));
  expect(api.list).not.toHaveBeenCalled();
  const details = container.querySelector("details") as HTMLDetailsElement;
  await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  expect(api.list).toHaveBeenCalled();
  expect(api.switchTo).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-current="true"]')).toHaveProperty("disabled", true);
  const two = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Two")) as HTMLButtonElement;
  await act(async () => two.click());
  expect(api.switchTo).toHaveBeenCalledWith("C:\\Projects\\Two");
  expect(details.open).toBe(false);
});
