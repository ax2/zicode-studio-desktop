import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { appendMetricSample, formatBytes, percentage, type MetricSample, type SystemInformation } from "./system-info-logic";
import { CapacityBar, MemoryRing, MetricHistory } from "./SystemMetricCharts";
import { TemperatureControls } from "./TemperatureControls";

export function SystemInfoTab() {
  const [data, setData] = useState<SystemInformation | null>(null), [history, setHistory] = useState<MetricSample[]>([]);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    const visible = () => document.visibilityState !== "hidden";
    let alive = true, pending = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!alive || pending || !visible()) return;
      pending = true; setBusy(true);
      try {
        const invoke = (globalThis as { __TAURI__?: { core?: { invoke<T>(name: string): Promise<T> } } }).__TAURI__?.core?.invoke;
        if (!invoke) throw new Error("Desktop unavailable");
        const result = await invoke<SystemInformation>("get_system_information");
        if (alive) { setData(result); setHistory(previous => appendMetricSample(previous, result)); setError(false); }
      } catch { if (alive) setError(true); }
      finally { pending = false; if (alive) { setBusy(false); if (visible()) timer = setTimeout(load, 2500); } }
    };
    const visibility = () => { clearTimeout(timer); if (visible()) void load(); };
    refreshRef.current = () => { clearTimeout(timer); void load(); };
    document.addEventListener("visibilitychange", visibility); void load();
    return () => { refreshRef.current = () => {}; alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const memoryUsed = data ? Math.max(0, data.memoryTotal - data.memoryAvailable) : 0;
  const frequency = data?.reportedFrequencyMhz ? data.reportedFrequencyMhz / 1000 : null;
  const maximumFrequency = Math.max(1, (data?.maxFrequencyMhz ?? 0) / 1000, ...history.map(sample => sample.frequency ?? 0));
  return <section className="system-information" aria-label={t("System information")}>
    <div className="ui-toolbar"><h2>{t("System information")}</h2><button type="button" className="ui-button ui-button--secondary" disabled={busy} onClick={() => refreshRef.current()}>{t("Refresh")}</button></div>
    <p className="ui-muted">{data ? `${t("Last updated")}: ${new Date(data.sampledAt).toLocaleTimeString()}` : t("Loading system information…")}</p>
    {error && <p role="alert">{t("System information is unavailable. Retry in the desktop app.")}</p>}
    {data && <>
      <div className="system-info-overview">
        <section className="ui-card">
          <div className="system-info-card-heading"><h3>CPU</h3><strong className="system-info-value">{data.cpuUsage === null ? "—" : `${data.cpuUsage.toFixed(1)}%`}</strong></div>
          <p translate="no" className="system-info-cpu-name">{data.cpuName}</p>
          <p className="ui-muted">{t("Logical processors")}: {data.logicalProcessors} · {t("CPU usage")}</p>
          <MetricHistory history={history} field="cpu" maximum={100} label={t("CPU usage")} unit="%" />
        </section>
        <section className="ui-card"><h3>{t("System memory")}</h3>
          <div className="system-info-memory-layout">
            <MemoryRing used={percentage(memoryUsed, data.memoryTotal)} />
            <dl><dt>{t("Used memory")}</dt><dd>{formatBytes(memoryUsed)}</dd><dt>{t("Available memory")}</dt><dd>{formatBytes(data.memoryAvailable)}</dd><dt>{t("Total memory")}</dt><dd>{formatBytes(data.memoryTotal)}</dd></dl>
          </div>
        </section>
        <section className="ui-card">
          <div className="system-info-card-heading"><h3>{t("CPU temperature")}</h3><strong className="system-info-value">{data.temperatureCelsius === null ? "—" : `${data.temperatureCelsius.toFixed(1)} °C`}</strong></div>
          <MetricHistory history={history} field="temperature" maximum={Math.max(120, ...history.map(sample => sample.temperature ?? 0))} label={t("CPU temperature")} unit="°C" />
          <p className="ui-muted">{data.temperatureSource ? `${t("Temperature source")}: ${data.temperatureSource}` : t("Sensor unavailable")}</p>
          <TemperatureControls data={data} onChanged={() => refreshRef.current()} />
        </section>
        <section className="ui-card">
          <div className="system-info-card-heading"><h3>{t("Reported frequency")}</h3><strong className="system-info-value">{frequency === null ? "—" : `${frequency.toFixed(2)} GHz`}</strong></div>
          <MetricHistory history={history} field="frequency" maximum={maximumFrequency} label={t("Reported frequency")} unit=" GHz" />
          <dl><dt>{t("Maximum reported frequency")}</dt><dd>{data.maxFrequencyMhz ? `${(data.maxFrequencyMhz / 1000).toFixed(2)} GHz` : t("Unavailable")}</dd></dl>
          <p className="ui-muted">{t("Frequency is reported by Windows, not an effective per-core clock measurement.")}</p>
        </section>
      </div>
      <section className="ui-card"><h3>{t("Disks")}</h3><div className="system-info-grid">{data.disks.map(disk => {
        const used = Math.max(0, disk.totalBytes - disk.freeBytes), occupied = percentage(used, disk.totalBytes);
        return <article key={disk.name} className="system-info-disk"><div className="system-info-card-heading"><h4>{disk.name}</h4><strong>{occupied.toFixed(1)}%</strong></div>
          <CapacityBar used={occupied} label={`${disk.name} ${t("Disk usage")}`} />
          <dl><dt>{t("Used space")}</dt><dd>{formatBytes(used)}</dd><dt>{t("Free space")}</dt><dd>{formatBytes(disk.freeBytes)}</dd><dt>{t("Total space")}</dt><dd>{formatBytes(disk.totalBytes)}</dd></dl>
        </article>;
      })}</div></section>
    </>}
  </section>;
}
