import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { FinanceSessionEntry } from "./FinanceSessionEntry";
import { createFinanceSessionEntry } from "./finance-session-entry";

const entries: ReturnType<typeof createFinanceSessionEntry>[] = [];
function entry(open: () => Promise<unknown>) {
  const store = createFinanceSessionEntry(open); entries.push(store); return store;
}
afterEach(() => { cleanup(); for (const store of entries.splice(0)) store.getState().destroy(); setLocale("zh-CN"); });

it("opens only after a click, blocks duplicate requests and recovers from failure", async () => {
  setLocale("en");
  let reject: (reason: Error) => void = () => {};
  const open = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
  const store = entry(open), view = render(<FinanceSessionEntry store={store} />);
  expect(open).not.toHaveBeenCalled(); expect(view.container.textContent).not.toMatch(/scene/i);
  const button = view.getByRole("button"); fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1)); expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { reject(new Error("private-token/path")); });
  expect(view.getByRole("alert").textContent).toBe("Could not open the Finance Workbench. Try again.");
  expect(view.container.textContent).not.toContain("private-token/path");
  open.mockImplementation(async () => undefined); fireEvent.click(button);
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(open).toHaveBeenCalledTimes(2); expect(view.queryByRole("alert")).toBeNull();
});

it.each([false, { ok: false, error: "private error" }])("reports a rejected open result without exposing its details: %j", async result => {
  setLocale("zh-CN");
  const view = render(<FinanceSessionEntry store={entry(async () => result)} />);
  fireEvent.click(view.getByRole("button"));
  await waitFor(() => expect(view.getByRole("alert").textContent).toBe("未能打开金融工作台，请重试。"));
  expect(view.container.textContent).not.toContain("private error");
});

it("retains the pending operation and failure across locale-driven view remounts", async () => {
  let finish: (value: unknown) => void = () => {};
  const open = vi.fn(() => new Promise(resolve => { finish = resolve; })), store = entry(open);
  let view = render(<FinanceSessionEntry store={store} />);
  fireEvent.click(view.getByRole("button"));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  view.unmount(); setLocale("en"); view = render(<FinanceSessionEntry store={store} />);
  expect((view.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole("button")); expect(open).toHaveBeenCalledTimes(1);
  await act(async () => { finish(false); });
  view.unmount(); setLocale("zh-CN"); view = render(<FinanceSessionEntry store={store} />);
  expect(view.getByRole("alert").textContent).toBe("未能打开金融工作台，请重试。");
});
