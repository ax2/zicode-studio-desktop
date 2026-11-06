import { expect, it } from "vitest";
import { appendMetricSample, metricPaths, type MetricSample, type SystemInformation } from "./system-info-logic";
const base: SystemInformation = { sampledAt: 100000, cpuName: "CPU", logicalProcessors: 8, cpuUsage: 25, reportedFrequencyMhz: 2500, maxFrequencyMhz: 4000, memoryTotal: 100, memoryAvailable: 40, disks: [], temperatureCelsius: 53.5, temperatureSource: "LibreHardwareMonitor" };
it("keeps a bounded minute of actual samples, ignores duplicates and older results", () => {
  let history = appendMetricSample([], base);
  expect(history[0]).toEqual({ at: 100000, cpu: 25, memory: 60, frequency: 2.5, temperature: 53.5 });
  expect(appendMetricSample(history, base)).toBe(history);
  expect(appendMetricSample(history, { ...base, sampledAt: 99999 })).toBe(history);
  for (let i = 1; i <= 100; i++) history = appendMetricSample(history, { ...base, sampledAt: 100000 + i * 100 });
  expect(history).toHaveLength(64);
  expect(appendMetricSample(history, { ...base, sampledAt: 200000 })).toHaveLength(1);
});
it("leaves gaps for unavailable measurements and pauses instead of inventing zero temperatures", () => {
  const sample = (at: number, temperature: number | null): MetricSample => ({ at, temperature, cpu: 0, memory: 0, frequency: null });
  const paths = metricPaths([sample(1000, 30), sample(3000, null), sample(5000, 60), sample(20000, 90)], "temperature", 120);
  expect(paths).toHaveLength(3);
  expect(paths.every(path => path.startsWith("M") && !path.includes(" L"))).toBe(true);
  expect(metricPaths([sample(1000, null)], "temperature", 120)).toEqual([]);
  expect(metricPaths([sample(1000, Number.NaN)], "temperature", 120)).toEqual([]);
});
