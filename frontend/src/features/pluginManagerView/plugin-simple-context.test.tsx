import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { PluginManagerViewApp } from "./PluginManagerViewApp";

afterEach(() => { cleanup(); setLocale("zh-CN"); });
it("explains plugin management without exposing internal scope while preserving permission actions", async () => {
  setLocale("en");
  const setPermission = vi.fn(async () => {});
  const view = render(<PluginManagerViewApp getTarget={() => ({ sceneId: "legacy-private" })} registry={{ list: () => [{
    id: "sample", name: "Sample tool", description: "Test plugin", enabled: true, origin: "developer",
    permissions: { "resource.read": false }, permissionDetails: { required: [{ name: "resource.read", reason: "Read confirmed inputs" }] },
  }], setPermission }} />);
  expect(view.container.textContent).not.toMatch(/scene|legacy-private/i);
  fireEvent.click(view.getByRole("button", { name: "Denied" }));
  await waitFor(() => expect(setPermission).toHaveBeenCalledWith("sample", "resource.read", true));
});
