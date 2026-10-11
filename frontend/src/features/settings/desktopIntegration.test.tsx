import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { DesktopIntegrationSettings } from "./DesktopIntegrationSettings";
afterEach(cleanup);
const reply = (installed: number) => ({ supported: true, installed });
it("reads only on mount and cancels without changing registration", async () => {
  const invoke = vi.fn().mockResolvedValue(reply(0));
  const view = render(<DesktopIntegrationSettings invoke={invoke} />);
  await waitFor(() =>
    expect(view.getByRole("button", { name: t("Add Explorer menu") })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(view.getByText(t("Add Explorer menu")));
  fireEvent.click(view.getByText(t("Cancel")));
  expect(invoke.mock.calls).toEqual([["desktop_explorer_menu", { action: "status" }]]);
});
it("requires confirmation, serializes writes and displays returned state", async () => {
  let finish: (value: unknown) => void = () => {};
  const invoke = vi
    .fn()
    .mockResolvedValueOnce(reply(0))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    )
    .mockResolvedValueOnce(reply(0));
  const view = render(<DesktopIntegrationSettings invoke={invoke} />);
  await waitFor(() =>
    expect(view.getByText(t("Add Explorer menu"))).toHaveProperty("disabled", false),
  );
  fireEvent.click(view.getByText(t("Add Explorer menu")));
  const confirm = view.getByRole("button", { name: t("Confirm Explorer menu change") });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(invoke).toHaveBeenCalledTimes(2);
  finish(reply(4));
  await waitFor(() =>
    expect(view.getByText(t("Remove Explorer menu"))).toHaveProperty("disabled", false),
  );
  fireEvent.click(view.getByText(t("Remove Explorer menu")));
  fireEvent.click(view.getByRole("button", { name: t("Confirm Explorer menu change") }));
  await waitFor(() =>
    expect(view.getByText(`${t("Registered Explorer entries")}: 0/4`)).toBeTruthy(),
  );
  expect(invoke.mock.calls.map((c) => c[1].action)).toEqual(["status", "install", "remove"]);
});
it.each([
  "isolated-profile",
  "windows-only",
])("disables mutation when unsupported: %s", async (reason) => {
  const invoke = vi.fn().mockResolvedValue({ supported: false, reason });
  const view = render(<DesktopIntegrationSettings invoke={invoke} />);
  await waitFor(() =>
    expect(view.getByText(t("Check menu status"))).toHaveProperty("disabled", false),
  );
  expect(view.getByText(t("Add Explorer menu"))).toHaveProperty("disabled", true);
  expect(view.getByText(t("Remove Explorer menu"))).toHaveProperty("disabled", true);
});
it("invalid response leaves state unknown; refresh is explicit", async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({ supported: true, installed: 99 })
    .mockResolvedValueOnce(reply(1));
  const view = render(<DesktopIntegrationSettings invoke={invoke} />);
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toContain(
      t(
        "Explorer menu status is unknown. Check again before changing it. An existing entry may belong to another installation.",
      ),
    ),
  );
  expect(view.getByText(t("Add Explorer menu"))).toHaveProperty("disabled", true);
  expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByText(t("Check menu status")));
  await waitFor(() =>
    expect(view.getByText(`${t("Registered Explorer entries")}: 1/4`)).toBeTruthy(),
  );
});
it("failed mutation does not retain an optimistic success or retry", async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce(reply(3))
    .mockRejectedValueOnce(new Error("foreign installation"));
  const view = render(<DesktopIntegrationSettings invoke={invoke} />);
  await waitFor(() =>
    expect(view.getByText(t("Remove Explorer menu"))).toHaveProperty("disabled", false),
  );
  fireEvent.click(view.getByText(t("Remove Explorer menu")));
  fireEvent.click(view.getByRole("button", { name: t("Confirm Explorer menu change") }));
  await waitFor(() =>
    expect(view.getByText(t("Remove Explorer menu"))).toHaveProperty("disabled", true),
  );
  expect(invoke).toHaveBeenCalledTimes(2);
});
it("hides the section without a desktop invoke bridge", () => {
  const view = render(<DesktopIntegrationSettings />);
  expect(view.container.textContent).toBe("");
});

it.each([3, 4])("handles a %i-entry installation without automatic writes", async (count) => {
  const invoke = vi.fn().mockResolvedValue(reply(count));
  const view = render(<DesktopIntegrationSettings invoke={invoke} />);
  await waitFor(() =>
    expect(view.getByText(`${t("Registered Explorer entries")}: ${count}/4`)).toBeTruthy(),
  );
  expect(view.getByText(t("Add Explorer menu"))).toHaveProperty("disabled", count === 4);
  expect(invoke.mock.calls).toEqual([["desktop_explorer_menu", { action: "status" }]]);
  if (count === 3) {
    fireEvent.click(view.getByText(t("Add Explorer menu")));
    expect(
      view.getByText(
        t(
          "Add file, folder, folder background and drive menus for this Windows user? Files open the tool center; sharing and execution require separate confirmation. Keep this Studio installation in its current location.",
        ),
      ),
    ).toBeTruthy();
    fireEvent.click(view.getByText(t("Cancel")));
    expect(invoke).toHaveBeenCalledTimes(1);
  }
});
