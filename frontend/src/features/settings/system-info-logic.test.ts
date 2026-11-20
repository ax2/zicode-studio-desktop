// @vitest-environment node
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

it("resumes a new timeline after the Windows clock moves backwards", () => {
  let history = appendMetricSample([], { ...base, sampledAt: 3_600_000 });
  history = appendMetricSample(history, { ...base, sampledAt: 3_602_500 });
  const corrected = appendMetricSample(history, { ...base, sampledAt: 120_000, cpuUsage: 75 });
  expect(corrected).toHaveLength(1);
  expect(corrected[0]).toMatchObject({ at: 120_000, cpu: 75 });
  const resumed = appendMetricSample(corrected, { ...base, sampledAt: 122_500 });
  expect(resumed).toHaveLength(2);
  expect(resumed[1].at).toBe(122_500);
  expect(history).toHaveLength(2);
});

it("bounds a day of sampling and keeps unavailable sensors as gaps", () => {
  let history: MetricSample[] = [];
  const samples = 40_000;
  for (let tick = 0; tick < samples; tick++) {
    const sampledAt = base.sampledAt + tick * 2500;
    history = appendMetricSample(history, { ...base, sampledAt, temperatureCelsius: tick % 5 ? 53.5 : null });
    if (tick % 2000 === 0) {
      expect(history.length).toBeLessThanOrEqual(64);
      expect(history.every(sample => sample.at >= sampledAt - 60_000)).toBe(true);
    }
  }
  expect(history.length).toBeLessThanOrEqual(64);
  expect(history.at(-1)?.at).toBe(base.sampledAt + (samples - 1) * 2500);
  const paths = metricPaths(history, "temperature", 120);
  expect(paths.length).toBeGreaterThan(1);
  expect(paths.join("")).not.toMatch(/NaN|Infinity/);
  expect(paths.join("").length).toBeLessThan(5000);
});
