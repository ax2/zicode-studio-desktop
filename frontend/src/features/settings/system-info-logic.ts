export interface SystemInformation {
  sampledAt: number;
  cpuName: string;
  logicalProcessors: number;
  cpuUsage: number | null;
  reportedFrequencyMhz: number | null;
  maxFrequencyMhz: number | null;
  memoryTotal: number;
  memoryAvailable: number;
  disks: { name: string; totalBytes: number; freeBytes: number }[];
  temperatureCelsius: number | null;
  temperatureSource: string | null;
  temperatureMonitor?: { state: string; libraryAvailable: boolean; driverAvailable: boolean };
}
export interface MetricSample { at: number; cpu: number | null; memory: number; frequency: number | null; temperature: number | null }
export type MetricField = "cpu" | "memory" | "frequency" | "temperature";
export const percentage = (used: number, total: number) => total > 0 ? Math.max(0, Math.min(100, used * 100 / total)) : 0;
export const formatBytes = (value: number) => `${(value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`;
export function appendMetricSample(history: MetricSample[], data: SystemInformation): MetricSample[] {
  if (!Number.isFinite(data.sampledAt) || (history.length && data.sampledAt <= history[history.length - 1].at)) return history;
  const next: MetricSample = { at: data.sampledAt, cpu: data.cpuUsage, memory: percentage(data.memoryTotal - data.memoryAvailable, data.memoryTotal), frequency: data.reportedFrequencyMhz === null ? null : data.reportedFrequencyMhz / 1000, temperature: data.temperatureCelsius };
  return [...history.filter(sample => sample.at >= next.at - 60000), next].slice(-64);
}
// SVG dimensions describe chart geometry, not UI spacing. Keep gaps for missing
// samples or pauses instead of drawing a fabricated continuous measurement.
export function metricPaths(history: MetricSample[], field: MetricField, maximum: number): string[] {
  if (!history.length || maximum <= 0) return [];
  const now = history[history.length - 1].at, paths: string[] = [];
  let path = "", previous = 0;
  for (const sample of history) {
    const value = sample[field];
    if (value === null || !Number.isFinite(value) || sample.at < now - 60000) { if (path) paths.push(path); path = ""; continue; }
    if (previous && sample.at - previous > 10000) { if (path) paths.push(path); path = ""; }
    const x = 2 + Math.max(0, Math.min(1, (sample.at - now + 60000) / 60000)) * 296;
    const y = 72 - Math.max(0, Math.min(1, value / maximum)) * 68;
    path += `${path ? " L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    previous = sample.at;
  }
  if (path) paths.push(path);
  return paths;
}
