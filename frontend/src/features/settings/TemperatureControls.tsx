import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { SystemInformation } from "./system-info-logic";

export function TemperatureControls({ data, onChanged }: { data: SystemInformation; onChanged(): void }) {
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const status = data.temperatureMonitor;
  const active = status && ["running", "starting", "no_reading"].includes(status.state);
  const change = async () => {
    setPending(true); setError("");
    try {
      const invoke = (globalThis as { __TAURI__?: { core?: { invoke(name: string): Promise<unknown> } } }).__TAURI__?.core?.invoke;
      if (!invoke) throw new Error("Could not start CPU temperature monitoring.");
      await invoke(active ? "stop_system_temperature_monitor" : "start_system_temperature_monitor");
      if (alive.current) onChanged();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (alive.current) setPending(false); }
  };
  if (data.temperatureCelsius !== null && !active) return null;
  return <div className="system-info-temperature-controls">
    {status?.libraryAvailable && status.driverAvailable ? <>
      <button type="button" className="ui-button ui-button--secondary" disabled={pending || status.state === "starting"} aria-busy={pending} onClick={() => void change()}>
        {pending || status.state === "starting" ? t("Waiting for Windows authorization…") : active ? t("Stop temperature monitoring") : t("Enable temperature monitoring")}
      </button>
      <p className="ui-muted">{active ? t("Temperature monitoring stops when Studio exits.") : t("Windows authorization is needed only for the CPU sensor reader. Studio keeps its normal permissions.")}</p>
    </> : <p className="ui-muted">{t("Temperature monitoring uses an installed LibreHardwareMonitor and PawnIO driver.")}</p>}
    {status?.state === "no_reading" && <p role="status">{t("The sensor has not returned a valid temperature yet.")}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </div>;
}
