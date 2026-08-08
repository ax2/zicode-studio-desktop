import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { t } from "../../shared/i18n";
import {
  buildActivityMonthLabels,
  buildModelSummary,
  deriveOverviewMetrics,
  formatCompact,
  formatInt,
  formatSessionDate,
  formatUsd,
  getModelChartPalette,
  getStackSegmentRadius,
  getToolChartPalette,
  overviewNote,
  RANGE_DAYS,
  STAT_ICONS,
  type CostRow,
  type CostSession,
  type ToolCostRow,
} from "./costDashboardLogic";
import type { CostDashboardStore } from "./costDashboardStore";

type ChartConstructor = new (canvas: HTMLCanvasElement, config: unknown) => { destroy(): void };

function getChartConstructor(): ChartConstructor | null {
  const chart = (window as unknown as { Chart?: ChartConstructor }).Chart;
  return typeof chart === "function" ? chart : null;
}

export function CostDashboardTab({
  store,
  onRetry,
}: {
  store: CostDashboardStore;
  onRetry?: () => void;
}) {
  const status = store((state) => state.status);
  const error = store((state) => state.error);
  const range = store((state) => state.range);
  const payload = store((state) => state.payload);
  const overview = useMemo(
    () => (payload ? deriveOverviewMetrics(payload, payload.infobar.overview) : null),
    [payload],
  );
  const modelSummary = useMemo(
    () => (payload ? buildModelSummary(payload.infobar.models, payload) : null),
    [payload],
  );
  const usage = payload?.infobar.usage;

  if (status === "loading") {
    return (
      <div className="cost-dash-page">
        <p className="cost-dash-empty-state">Loading usage…</p>
      </div>
    );
  }
  if (status === "error" || !payload || !overview || !modelSummary || !usage) {
    return (
      <div className="cost-dash-page">
        <p className="cost-dash-empty-state cost-dash-error">
          {error || "Failed to load usage data"}
        </p>
        {onRetry ? (
          <button type="button" className="ui-button ui-button--secondary" onClick={onRetry}>
            {t("Retry")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="cost-dash-page">
      <section id="cost-dash-section">
        <div className="cost-dash-topbar">
          <div className="cost-dash-topbar-actions">
            {/* biome-ignore lint/a11y/useSemanticElements: ARIA group pattern preserved from the vanilla range chips */}
            <div className="cost-dash-quick-range" role="group" aria-label="Quick range">
              {Object.keys(RANGE_DAYS).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`cost-dash-range-chip${range === key ? " is-active" : ""}`}
                  data-range-chip={key}
                  aria-pressed={range === key}
                  onClick={() => store.getState().setRange(key)}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="cost-dash-panels">
          <div className="cost-dash-panel is-active" id="usage-overview">
            <div className="cost-dash-cost-block">
              <div className="cost-dash-subsection-head">
                <h3>Overview</h3>
              </div>
              <div className="cost-dash-overview-grid">
                <OverviewStats overview={overview} usage={usage} />
              </div>
              <div className="cost-dash-activity-wrap">
                <ActivityPanel payload={payload} />
              </div>
              <p className="cost-dash-overview-note">{overviewNote(overview.totalTokens)}</p>
            </div>
          </div>

          <div className="cost-dash-section-row">
            <div className="cost-dash-panel is-active" id="usage-models">
              <div className="cost-dash-cost-block">
                <div className="cost-dash-subsection-head">
                  <h3>Models</h3>
                </div>
                <ModelsPanel summary={modelSummary} />
              </div>
            </div>

            <div className="cost-dash-right-col">
              <div className="cost-dash-panel is-active" id="usage-tool-cost">
                <div className="cost-dash-cost-block">
                  <div className="cost-dash-subsection-head">
                    <h3>Tool Cost</h3>
                  </div>
                  <ToolCostPanel tools={usage.tools ?? []} />
                </div>
              </div>

              <div className="cost-dash-panel is-active" id="usage-projects">
                <div className="cost-dash-cost-block">
                  <div className="cost-dash-subsection-head">
                    <h3>Projects</h3>
                  </div>
                  <ProjectsPanel rows={payload.infobar.projects} />
                </div>
              </div>
            </div>
          </div>

          <div className="cost-dash-panel is-active" id="usage-sessions">
            <div className="cost-dash-cost-block">
              <div className="cost-dash-subsection-head">
                <h3>Sessions</h3>
                <span>Recent sessions in range</span>
              </div>
              <SessionsPanel sessions={payload.sessions} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function OverviewStats({
  overview,
  usage,
}: {
  overview: ReturnType<typeof deriveOverviewMetrics>;
  usage: { inputTokens?: number; outputTokens?: number; cacheRead?: number; cacheWrite?: number; toolCalls?: number };
}) {
  const stats: Array<[string, string, string]> = [
    ["Total cost", formatUsd(overview.totalCost), "green"],
    ["Sessions", formatInt(overview.sessions), "blue"],
    ["Messages", formatInt(overview.messages), "violet"],
    ["Total tokens", formatCompact(overview.totalTokens), "teal"],
    ["Active days", formatInt(overview.activeDays), "amber"],
    ["Current streak", `${formatInt(overview.currentStreak)}d`, "blue"],
    ["Longest streak", `${formatInt(overview.longestStreak)}d`, "violet"],
    ["Peak hour", overview.peakHour == null ? "—" : `${overview.peakHour}:00`, "rose"],
    ["Input", formatCompact(usage.inputTokens), "teal"],
    ["Output", formatCompact(usage.outputTokens), "green"],
    ["Cache Read", formatCompact(usage.cacheRead), "amber"],
    ["Cache Write", formatCompact(usage.cacheWrite), "violet"],
    ["Tool Calls", formatInt(usage.toolCalls), "rose"],
  ];
  return (
    <>
      {stats.map(([title, value, tone]) => (
        <article key={title} className={`cost-dash-stat-card cost-dash-card-tone-${tone}`}>
          <div className="cost-dash-stat-title">
            {STAT_ICONS[title] ? <Icon svg={STAT_ICONS[title]} /> : null}
            {title}
          </div>
          <div className="cost-dash-stat-value">{value}</div>
        </article>
      ))}
    </>
  );
}

function Icon({ svg }: { svg: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = svg;
  }, [svg]);
  return <span ref={ref} className="cost-dash-stat-icon" aria-hidden="true" />;
}

function ActivityPanel({ payload }: { payload: Parameters<typeof deriveOverviewMetrics>[0] }) {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const intensityByDay = new Map<string, number>();
  for (const session of sessions) {
    const time = new Date(String(session.time ?? ""));
    if (!Number.isFinite(time.getTime())) continue;
    const key = time.toISOString().slice(0, 10);
    intensityByDay.set(key, (intensityByDay.get(key) || 0) + Number(session.totalTokens || 0));
  }

  const TOTAL_DAYS = 365;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: Array<{ key: string; value: number }> = [];
  for (let i = TOTAL_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, value: intensityByDay.get(key) || 0 });
  }

  const max = Math.max(...days.map((day) => day.value), 0);
  const leadingEmptyDays = new Date(`${days[0]?.key}T00:00:00`).getDay();
  const totalCells = leadingEmptyDays + days.length;
  const weekColumns = Math.ceil(totalCells / 7);
  const monthLabels = buildActivityMonthLabels(days, leadingEmptyDays);

  return (
    <div
      className="cost-dash-activity-calendar"
      style={{ "--activity-columns": weekColumns } as CSSProperties}
    >
      <div className="cost-dash-activity-months" aria-hidden="true">
        {monthLabels.map((label) => (
          <span
            key={`${label.column}-${label.name}`}
            className="cost-dash-activity-month"
            style={{ gridColumn: label.column }}
          >
            {label.name}
          </span>
        ))}
      </div>
      <div className="cost-dash-activity-body">
        <div className="cost-dash-activity-weekdays" aria-hidden="true">
          <span></span>
          <span>Mon</span>
          <span></span>
          <span>Wed</span>
          <span></span>
          <span>Fri</span>
          <span></span>
        </div>
        <div className="cost-dash-activity-grid">
          {Array.from({ length: leadingEmptyDays }, (_, index) => index + 1).map((cell) => (
            <div
              key={`empty-${cell}`}
              className="cost-dash-activity-cell is-empty"
              aria-hidden="true"
            ></div>
          ))}
          {days.map((day) => {
            let level = 0;
            if (max > 0) {
              const ratio = day.value / max;
              if (ratio >= 0.75) level = 4;
              else if (ratio >= 0.5) level = 3;
              else if (ratio >= 0.25) level = 2;
              else if (ratio > 0) level = 1;
            }
            return (
              <div
                key={day.key}
                className={`cost-dash-activity-cell level-${level}`}
                title={`${day.key} · ${formatCompact(day.value)} tokens`}
              ></div>
            );
          })}
        </div>
      </div>
      <div className="cost-dash-activity-footer">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={`cost-dash-activity-cell level-${level}`}
            aria-hidden="true"
          ></span>
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function ModelsPanel({ summary }: { summary: ReturnType<typeof buildModelSummary> }) {
  if (summary.series.length === 0 || summary.labels.length === 0) {
    return <div className="cost-dash-empty-state">No data in selected range.</div>;
  }
  return (
    <div className="cost-dash-models-card">
      <div className="cost-dash-models-chart-wrap">
        <ModelsChart summary={summary} />
      </div>
      <div className="cost-dash-models-legend">
        {summary.models.map((model, index) => {
          const percent = Math.round((model.fraction || 0) * 1000) / 10;
          return (
            <div key={model.name} className="cost-dash-model-legend-row">
              <div className="cost-dash-model-legend-main">
                <span className={`cost-dash-tool-legend-dot cost-dash-model-color-${index + 1}`}></span>
                <span className="cost-dash-model-legend-name">{model.name}</span>
              </div>
              <div className="cost-dash-model-legend-meta">
                <span>
                  {formatCompact(model.inputTokens)} in · {formatCompact(model.outputTokens)} out
                </span>
                <span>{percent}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModelsChart({ summary }: { summary: ReturnType<typeof buildModelSummary> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<{ destroy(): void } | null>(null);
  const Chart = getChartConstructor();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !Chart) return;
    chartRef.current?.destroy();
    const colors = getModelChartPalette();
    chartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels: summary.labels,
        datasets: summary.series.map((series, index) => ({
          label: series.name,
          data: series.data,
          backgroundColor: colors[index] || colors[colors.length - 1],
          borderRadius(context: { dataIndex: number }) {
            return getStackSegmentRadius(summary.series, index, context.dataIndex);
          },
          borderSkipped: false,
          maxBarThickness: 30,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context: { dataset: { label?: string }; raw: unknown }) {
                return `${context.dataset.label}: ${formatCompact(context.raw)} tokens`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            border: { display: false },
            ticks: { color: "#8f959e", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          },
          y: {
            stacked: true,
            grid: { color: "rgba(255,255,255,0.08)" },
            border: { display: false },
            ticks: {
              color: "#8f959e",
              callback(value: unknown) {
                return formatCompact(value);
              },
            },
          },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [summary, Chart]);
  if (!Chart) {
    return <div className="cost-dash-empty-state">Chart unavailable in this environment.</div>;
  }
  return <canvas ref={canvasRef} className="cost-dash-models-chart" width="960" height="320" />;
}

function DoughnutPanel({
  rows,
  chartClass,
  fallbackClass,
  emptyText,
  slotLabel,
}: {
  rows: Array<{ name?: string; cost?: number; sessions?: number; count?: number }>;
  chartClass: string;
  fallbackClass: string;
  emptyText: string;
  slotLabel: (row: { sessions?: number; count?: number }) => string;
}) {
  const top = useMemo(() => rows.slice(0, 6), [rows]);
  if (rows.length === 0) {
    return <div className="cost-dash-empty-state">{emptyText}</div>;
  }
  const totalCost = top.reduce((sum, row) => sum + Number(row.cost || 0), 0);
  return (
    <div className="cost-dash-tool-chart-layout">
      <div className="cost-dash-tool-chart-wrap">
        <DoughnutChart rows={top} chartClass={chartClass} fallbackClass={fallbackClass} />
      </div>
      <div className="cost-dash-tool-legend">
        {top.map((row, index) => {
          const percent = totalCost > 0 ? Math.round((Number(row.cost || 0) / totalCost) * 100) : 0;
          return (
            <div key={row.name} className="cost-dash-tool-legend-row">
              <div className="cost-dash-tool-legend-main">
                <span className="cost-dash-tool-legend-dot" data-tool-color={index}></span>
                <div>
                  <div className="cost-dash-tool-legend-title">{row.name || "unknown"}</div>
                  <div className="cost-dash-tool-legend-subtitle">{slotLabel(row)}</div>
                </div>
              </div>
              <div className="cost-dash-tool-legend-values">
                <span>{formatUsd(row.cost)}</span>
                <span>{percent}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DoughnutChart({
  rows,
  chartClass,
  fallbackClass,
}: {
  rows: Array<{ name?: string; cost?: number }>;
  chartClass: string;
  fallbackClass: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<{ destroy(): void } | null>(null);
  const Chart = getChartConstructor();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && Chart) {
      const labels = rows.map((row) => row.name || "unknown");
      const data = rows.map((row) => Number(row.cost || 0));
      const colors = getToolChartPalette().slice(0, rows.length);
      chartRef.current?.destroy();
      chartRef.current = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels,
          datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 2 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label(context: { label?: string; raw: unknown }) {
                  return `${context.label}: ${formatUsd(context.raw)}`;
                },
              },
            },
          },
        },
      });
      return () => {
        chartRef.current?.destroy();
        chartRef.current = null;
      };
    }
  }, [rows, Chart]);
  if (!Chart) {
    const data = rows.map((row) => Number(row.cost || 0));
    const colors = getToolChartPalette().slice(0, rows.length);
    const total = data.reduce((sum, value) => sum + value, 0);
    const conicStops = data.reduce(
      (parts, value, index) => {
        const start = parts.offset;
        const end = total > 0 ? start + (value / total) * 360 : start;
        parts.values.push(`${colors[index]} ${start}deg ${end}deg`);
        parts.offset = end;
        return parts;
      },
      { values: [] as string[], offset: 0 },
    );
    return (
      <div
        className={fallbackClass}
        style={{ background: `conic-gradient(${conicStops.values.join(", ")})` }}
      ></div>
    );
  }
  return <canvas ref={canvasRef} className={chartClass} width="240" height="240" />;
}

function ToolCostPanel({ tools }: { tools: ToolCostRow[] }) {
  return (
    <DoughnutPanel
      rows={tools}
      chartClass="cost-dash-tool-chart"
      fallbackClass="cost-dash-tool-chart-fallback"
      emptyText="No tool usage in selected range."
      slotLabel={(row) => `${formatInt(row.count)} sessions`}
    />
  );
}

function ProjectsPanel({ rows }: { rows: CostRow[] }) {
  return (
    <DoughnutPanel
      rows={rows}
      chartClass="cost-dash-projects-chart"
      fallbackClass="cost-dash-projects-chart-fallback"
      emptyText="No data in selected range."
      slotLabel={(row) => `${formatInt(row.sessions)} sessions`}
    />
  );
}

function SessionsPanel({ sessions }: { sessions: CostSession[] }) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return <div className="cost-dash-empty-state">No recent sessions in selected range.</div>;
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: region role preserved from the vanilla sessions table
    <div
      className="cost-dash-sessions-table-wrap"
      role="region"
      aria-label="Sessions table"
    >
      <table className="cost-dash-sessions-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Model</th>
            <th className="cost-dash-num">Tokens</th>
            <th className="cost-dash-num">Tools</th>
            <th className="cost-dash-num">Cost</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session, index) => (
            <tr key={String(session.time ?? index)}>
              <td className="cost-dash-sessions-td-title">
                <div className="cost-dash-sessions-title">
                  {String(session.title || "Untitled")}
                </div>
                {session.workspace ? (
                  <div className="cost-dash-sessions-workspace">
                    {String(session.workspace)}
                  </div>
                ) : null}
              </td>
              <td className="cost-dash-sessions-td-model">{String(session.model || "—")}</td>
              <td className="cost-dash-num">{formatCompact(session.totalTokens)}</td>
              <td className="cost-dash-num">{formatInt(session.toolCalls)}</td>
              <td className="cost-dash-num cost-dash-sessions-cost">
                {formatUsd(session.totalCost)}
              </td>
              <td className="cost-dash-sessions-td-date">{formatSessionDate(session.time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
