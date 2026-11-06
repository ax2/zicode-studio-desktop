import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { TemperatureControls } from "./TemperatureControls";
import type { SystemInformation } from "./system-info-logic";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const data: SystemInformation = { sampledAt: 100, cpuName: "CPU", logicalProcessors: 8, cpuUsage: 5, reportedFrequencyMhz: null, maxFrequencyMhz: null, memoryTotal: 100, memoryAvailable: 25, disks: [], temperatureCelsius: null, temperatureSource: null, temperatureMonitor: { state: "idle", libraryAvailable: true, driverAvailable: true } };
it("requests sensor authorization only on an explicit action and prevents duplicate requests", async () => {
  let finish!: () => void;
  const invoke = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  vi.stubGlobal("__TAURI__", { core: { invoke } });
  const changed = vi.fn(), view = render(<TemperatureControls data={data} onChanged={changed} />);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: t("Enable temperature monitoring") }));
  expect(invoke).toHaveBeenCalledWith("start_system_temperature_monitor");
  fireEvent.click(view.getByRole("button"));
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => finish()); expect(changed).toHaveBeenCalledTimes(1);
  view.rerender(<TemperatureControls data={{ ...data, temperatureCelsius: 53.5, temperatureMonitor: { state: "running", libraryAvailable: true, driverAvailable: true } }} onChanged={changed} />);
  fireEvent.click(view.getByRole("button", { name: t("Stop temperature monitoring") }));
  expect(invoke).toHaveBeenLastCalledWith("stop_system_temperature_monitor");
  await act(async () => finish());
});
it("keeps cancellation actionable without claiming a temperature or retrying elevation", async () => {
  const invoke = vi.fn(async () => { throw new Error("Temperature permission request was cancelled."); });
  vi.stubGlobal("__TAURI__", { core: { invoke } });
  const view = render(<TemperatureControls data={data} onChanged={vi.fn()} />);
  await act(async () => fireEvent.click(view.getByRole("button")));
  expect(view.getByRole("alert").textContent).toBe(t("Temperature permission request was cancelled."));
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(view.getByRole("button", { name: t("Enable temperature monitoring") }).hasAttribute("disabled")).toBe(false);
});

