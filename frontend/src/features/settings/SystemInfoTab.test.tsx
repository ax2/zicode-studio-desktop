import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { SystemInfoTab } from "./SystemInfoTab";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const data = { sampledAt: Date.now(), cpuName: "Test CPU", logicalProcessors: 8, cpuUsage: 32.5, reportedFrequencyMhz: 2400, maxFrequencyMhz: 4200, memoryTotal: 16 * 1024 ** 3, memoryAvailable: 6 * 1024 ** 3, disks: [{ name: "C:\\", totalBytes: 100 * 1024 ** 3, freeBytes: 40 * 1024 ** 3 }], temperatureCelsius: null, temperatureSource: null };
it("shows sampled metrics and explicitly unavailable temperature without estimating it", async () => {
  const invoke = vi.fn(async () => data); vi.stubGlobal("__TAURI__", { core: { invoke } });
  const view = render(<SystemInfoTab />);
  await act(async () => {});
  expect(invoke).toHaveBeenCalledWith("get_system_information");
  expect(view.getByText("Test CPU")).toBeTruthy();
  expect(view.getByText("2.40 GHz")).toBeTruthy();
  expect(view.getByText(t("Sensor unavailable"))).toBeTruthy();
  expect(view.getByText("10 GiB")).toBeTruthy();
  expect(view.queryByText("0 °C")).toBeNull();
});
it("stops refreshing after leaving the page and retains previous values if a refresh fails", async () => {
  vi.useFakeTimers();
  const invoke = vi.fn().mockResolvedValueOnce(data).mockRejectedValue(new Error("Unavailable")); vi.stubGlobal("__TAURI__", { core: { invoke } });
  const view = render(<SystemInfoTab />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(view.getByRole("alert")).toBeTruthy(); expect(view.getByText("Test CPU")).toBeTruthy();
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(invoke).toHaveBeenCalledTimes(2);
});
