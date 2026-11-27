import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { renderPluginManagerView } from "./index";
import type { PluginManagerRegistry } from "./PluginManagerViewApp";
import { t } from "../../shared/i18n";

afterEach(() => { document.body.replaceChildren(); });

function fixture(beforePermission?: () => Promise<void>, notify?: (message: string) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  const target = { sceneId: "programming", workspaceId: "first" };
  const plugins = Array.from({ length: 45 }, (_, index) => ({ id: `tool-${index}`, name: `Tool ${index}`,
    description: "", enabled: true, permissions: { "resource.read": false },
    permissionDetails: { required: [{ name: "resource.read" }] } }));
  const registry: PluginManagerRegistry = {
    list: () => plugins,
    setEnabled: async (id, enabled) => { const plugin = plugins.find(p => p.id === id); if (!plugin) throw new Error(id); plugin.enabled = enabled; refresh(true); },
    setPermission: async (id, name, granted) => {
      expect(name).toBe("resource.read");
      if (beforePermission) await beforePermission();
      const plugin = plugins.find(p => p.id === id); if (!plugin) throw new Error(id); plugin.permissions["resource.read"] = granted;
      refresh(true);
    },
  };
  const refresh = (preserveState = false) => renderPluginManagerView({ container, registry, getTarget: () => target, preserveState, notify });
  act(() => refresh());
  return { container, target, refresh };
}

it("preserves the search and focused action through a real manager permission refresh", async () => {
  const { container } = fixture();
  const wrapper = container.querySelector("[data-plugin-manager-root]");
  const input = screen.getByRole<HTMLInputElement>("searchbox");
  fireEvent.change(input, { target: { value: "tool-44" } });
  const grant = screen.getByRole("button", { name: t("Denied") });
  grant.focus();
  fireEvent.click(grant);
  await waitFor(() => expect(grant.textContent).toBe(t("Allowed")));
  expect(screen.getByRole("searchbox")).toBe(input);
  expect(input.value).toBe("tool-44");
  expect(document.activeElement).toBe(grant);
  expect(container.querySelector("[data-plugin-manager-root]")).toBe(wrapper);
  expect(container.querySelectorAll(".plugin-manager-card")).toHaveLength(1);
});

it("retains the second catalog page when a plugin is disabled", async () => {
  fixture();
  const page = screen.getByRole<HTMLInputElement>("spinbutton");
  fireEvent.change(page, { target: { value: "2" } });
  fireEvent.keyDown(page, { key: "Enter" });
  const card = screen.getByText("tool-44").closest("article");
  if (!card) throw new Error("Expected plugin card");
  fireEvent.click(within(card).getByRole("button", { name: t("Enabled") }));
  await within(card).findByRole("button", { name: t("Disabled") });
  expect(screen.getByRole("spinbutton")).toBe(page);
  expect(page.value).toBe("2");
  expect(screen.getByText("tool-44").closest("article")).toBe(card);
});

it("discards search state when the workspace changes or navigation remounts the manager", () => {
  const { target, refresh } = fixture();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "tool-44" } });
  target.workspaceId = "second";
  act(() => refresh(true));
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "tool-43" } });
  act(() => refresh());
  expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
});

it("keeps a pending permission action focused so a rejected write can be retried", async () => {
  let rejectFirst: ((reason: Error) => void) | undefined;
  let attempts = 0;
  const notices: string[] = [];
  const beforePermission = () => {
    attempts++;
    return attempts === 1
      ? new Promise<void>((_resolve, reject) => { rejectFirst = reject; })
      : Promise.resolve();
  };
  fixture(beforePermission, text => notices.push(text));
  const input = screen.getByRole<HTMLInputElement>("searchbox");
  fireEvent.change(input, { target: { value: "tool-44" } });
  const button = screen.getByRole<HTMLButtonElement>("button", { name: t("Denied") });
  button.focus();
  fireEvent.click(button);
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(attempts).toBe(1);

  await act(async () => rejectFirst?.(new Error("fixture permission refused")));
  expect(notices).toEqual(["fixture permission refused"]);
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-disabled")).toBeNull();
  expect(button.getAttribute("aria-pressed")).toBe("false");

  fireEvent.click(button);
  await waitFor(() => expect(button.textContent).toBe(t("Allowed")));
  expect(button.getAttribute("aria-busy")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(input.value).toBe("tool-44");
  expect(attempts).toBe(2);
});
