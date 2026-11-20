import { t } from "../../shared/i18n";
import { metricPaths, type MetricField, type MetricSample } from "./system-info-logic";

export function MetricHistory({ history, field, maximum, label, unit }: {
  history: MetricSample[]; field: MetricField; maximum: number; label: string; unit: string;
}) {
  const paths = metricPaths(history, field, maximum);
  return <figure className={`system-info-history system-info-history--${field}`}>
    <div className="system-info-chart-scale"><span>{label}</span><span>0–{maximum.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}</span></div>
    <svg viewBox="0 0 300 76" role="img" aria-label={`${label} · ${t("Last 60 seconds")}`}>
      <title>{label} · {t("Last 60 seconds")}</title>
      {[4, 38, 72].map(y => <line key={y} className="system-info-grid-line" x1="2" x2="298" y1={y} y2={y} />)}
      {paths.map(path => <path key={path} d={path} className="system-info-trend" />)}
      {paths.length === 0 && <text className="system-info-chart-empty" x="150" y="42" textAnchor="middle">{t("Waiting for samples…")}</text>}
    </svg>
    <figcaption><span>{t("60 seconds ago")}</span><span>{t("Now")}</span></figcaption>
  </figure>;
}

export function MemoryRing({ used }: { used: number }) {
  const value = Math.max(0, Math.min(100, used));
  return <svg className="system-info-memory-ring" viewBox="0 0 120 120" role="img" aria-label={`${t("Memory usage")}: ${value.toFixed(1)}%`}>
    <title>{t("Memory usage")}: {value.toFixed(1)}%</title>
    <circle className="system-info-ring-track" cx="60" cy="60" r="46" />
    <circle className="system-info-ring-used" cx="60" cy="60" r="46" pathLength="100" strokeDasharray={`${value} 100`} transform="rotate(-90 60 60)" />
    <text className="system-info-ring-value" x="60" y="59" textAnchor="middle">{value.toFixed(0)}%</text>
    <text className="system-info-ring-caption" x="60" y="76" textAnchor="middle">{t("Used")}</text>
  </svg>;
}

export function CapacityBar({ used, label }: { used: number; label: string }) {
  return <svg className="system-info-capacity" viewBox="0 0 100 5" role="img" aria-label={`${label}: ${used.toFixed(1)}%`}>
    <title>{label}: {used.toFixed(1)}%</title>
    <rect className="system-info-capacity-track" width="100" height="5" rx="2.5" />
    <rect className="system-info-capacity-used" width={Math.max(0, Math.min(100, used))} height="5" rx="2.5" />
  </svg>;
}
