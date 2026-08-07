export const FILTER_STORAGE_KEY = "pi-studio-cost-filters";
export const DEFAULT_RANGE = "30d";
export const RANGE_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export interface CostSession {
  time?: string;
  title?: string;
  workspace?: string;
  model?: string;
  totalCost?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  toolCalls?: number;
  userMessages?: number;
  projectName?: string;
  projectPath?: string;
  toolCostByName?: Record<string, number>;
}

export interface DashboardPayload {
  sessions?: CostSession[];
  topSessions?: CostSession[];
  summary?: {
    totalCost?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    toolCalls?: number;
    userMessageCount?: number;
    sessionCount?: number;
  };
}

export interface CostRow {
  name: string;
  cost: number;
  sessions: number;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  fraction?: number;
}

export interface ToolCostRow {
  name: string;
  cost: number;
  count: number;
  fraction: number;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  toolCalls: number;
  userMessageCount: number;
  sessionCount?: number;
  avgCostPerSession?: number;
  avgCostPerUserMessage?: number;
}

export function formatUsd(value: unknown): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

export function formatInt(value: unknown): string {
  return Number(value || 0).toLocaleString();
}

export function formatCompact(value: unknown): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

export function rangeBounds(range: string, now: Date = new Date()) {
  const days = RANGE_DAYS[range] ?? RANGE_DAYS[DEFAULT_RANGE];
  const to = new Date(now);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));
  return { from, to };
}

function isInRange(session: CostSession, bounds: { from: Date; to: Date }): boolean {
  const time = new Date(String(session?.time ?? ""));
  return Number.isFinite(time.getTime()) && time >= bounds.from && time <= bounds.to;
}

function number(value: unknown): number {
  return Number(value) || 0;
}

function aggregateRows(
  rows: CostSession[],
  getName: (row: CostSession) => string | undefined,
  update: (entry: CostRow, row: CostSession) => void,
): CostRow[] {
  const byName = new Map<string, CostRow>();
  for (const row of rows) {
    const name = getName(row) || "unknown";
    const existing = byName.get(name) || { name, cost: 0, sessions: 0, totalTokens: 0 };
    update(existing, row);
    byName.set(name, existing);
  }
  return Array.from(byName.values()).sort((left, right) => right.cost - left.cost);
}

function aggregateToolRows(sessions: CostSession[]): ToolCostRow[] {
  const byName = new Map<string, { name: string; cost: number; count: number }>();
  for (const session of sessions) {
    const costs = session.toolCostByName || {};
    for (const [name, costValue] of Object.entries(costs)) {
      const entry = byName.get(name) || { name, cost: 0, count: 0 };
      entry.cost += number(costValue);
      entry.count += 1;
      byName.set(name, entry);
    }
  }
  const total = Array.from(byName.values()).reduce((sum, row) => sum + row.cost, 0);
  return Array.from(byName.values())
    .map((row) => ({ ...row, fraction: total > 0 ? row.cost / total : 0 }))
    .sort((left, right) => right.cost - left.cost);
}

export function adaptDashboardToInfobarPayload(dashboard: DashboardPayload, range: string) {
  const allSessions = Array.isArray(dashboard?.sessions)
    ? dashboard.sessions
    : Array.isArray(dashboard?.topSessions)
      ? dashboard.topSessions
      : [];
  const bounds = rangeBounds(range);
  const sessions = allSessions.filter((session) => isInRange(session, bounds));

  const summary = sessions.reduce<CostSummary>(
    (totals, session) => {
      totals.totalCost += number(session.totalCost);
      totals.totalTokens += number(session.totalTokens);
      totals.inputTokens += number(session.inputTokens);
      totals.outputTokens += number(session.outputTokens);
      totals.cacheRead += number(session.cacheRead);
      totals.cacheWrite += number(session.cacheWrite);
      totals.toolCalls += number(session.toolCalls);
      totals.userMessageCount += number(session.userMessages);
      return totals;
    },
    {
      totalCost: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      toolCalls: 0,
      userMessageCount: 0,
    },
  );
  summary.sessionCount = sessions.length;
  summary.avgCostPerSession = sessions.length > 0 ? summary.totalCost / sessions.length : 0;
  summary.avgCostPerUserMessage =
    summary.userMessageCount > 0 ? summary.totalCost / summary.userMessageCount : 0;

  const models = aggregateRows(
    sessions,
    (session) => session.model,
    (entry, session) => {
      entry.cost += number(session.totalCost);
      entry.sessions += 1;
      entry.totalTokens += number(session.totalTokens);
      entry.inputTokens = number(entry.inputTokens) + number(session.inputTokens);
      entry.outputTokens = number(entry.outputTokens) + number(session.outputTokens);
    },
  ).map((entry) => ({
    ...entry,
    fraction: summary.totalTokens > 0 ? entry.totalTokens / summary.totalTokens : 0,
  }));

  const toolRows = aggregateToolRows(sessions);
  const projects = aggregateRows(
    sessions,
    (session) => session.projectName || session.workspace || session.projectPath,
    (entry, session) => {
      entry.cost += number(session.totalCost);
      entry.sessions += 1;
      entry.totalTokens += number(session.totalTokens);
    },
  );

  return {
    range: {
      range,
      from: bounds.from.toISOString(),
      to: bounds.to.toISOString(),
    },
    summary,
    infobar: {
      overview: {
        totalCost: summary.totalCost,
        sessionCount: summary.sessionCount,
        messageCount: summary.userMessageCount,
      },
      usage: {
        totalTokens: summary.totalTokens,
        inputTokens: summary.inputTokens || summary.totalTokens,
        outputTokens: summary.outputTokens,
        cacheRead: summary.cacheRead,
        cacheWrite: summary.cacheWrite,
        toolCalls: summary.toolCalls,
        tools: toolRows,
      },
      models,
      projects,
    },
    sessions: sessions
      .slice()
      .sort(
        (left, right) =>
          new Date(String(right.time ?? "")).getTime() -
          new Date(String(left.time ?? "")).getTime(),
      ),
  };
}

export type AdaptedDashboard = ReturnType<typeof adaptDashboardToInfobarPayload>;

export function deriveOverviewMetrics(
  payload: AdaptedDashboard,
  overview: { totalCost?: number; sessionCount?: number; messageCount?: number },
) {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const dayCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();

  for (const session of sessions) {
    const time = new Date(String(session.time ?? ""));
    if (!Number.isFinite(time.getTime())) continue;
    const dayKey = time.toISOString().slice(0, 10);
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    hourCounts.set(time.getHours(), (hourCounts.get(time.getHours()) || 0) + 1);
  }

  const sortedDays = Array.from(dayCounts.keys()).sort();
  let longestStreak = 0;
  let currentStreak = 0;
  let streak = 0;
  let previousDate: Date | null = null;

  for (const key of sortedDays) {
    const currentDate = new Date(`${key}T00:00:00`);
    if (previousDate) {
      const diffDays = Math.round((currentDate.getTime() - previousDate.getTime()) / 86400000);
      streak = diffDays === 1 ? streak + 1 : 1;
    } else {
      streak = 1;
    }
    longestStreak = Math.max(longestStreak, streak);
    previousDate = currentDate;
  }

  if (sortedDays.length > 0) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const cursor = new Date(`${todayKey}T00:00:00`);
    while (dayCounts.has(cursor.toISOString().slice(0, 10))) {
      currentStreak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  return {
    totalCost: overview.totalCost || payload.summary?.totalCost || 0,
    sessions: overview.sessionCount || sessions.length,
    messages: overview.messageCount || 0,
    totalTokens: payload.summary?.totalTokens || 0,
    activeDays: sortedDays.length,
    currentStreak,
    longestStreak,
    peakHour: Array.from(hourCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

export function buildModelSummary(rows: CostRow[], payload: AdaptedDashboard) {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const topModels = rows.slice(0, 3).map((row) => ({
    name: row.name || "unknown",
    fraction: Number(row.fraction || 0),
    inputTokens: 0,
    outputTokens: 0,
  }));
  const modelNames = new Set(topModels.map((model) => model.name));
  const byDay = new Map<string, Record<string, number>>();

  for (const session of sessions) {
    const modelName = session.model || "unknown";
    if (!modelNames.has(modelName)) continue;
    const time = new Date(String(session.time ?? ""));
    if (!Number.isFinite(time.getTime())) continue;
    const dayKey = time.toISOString().slice(0, 10);
    let day = byDay.get(dayKey);
    if (!day) {
      day = {};
      byDay.set(dayKey, day);
    }
    day[modelName] = (day[modelName] || 0) + Number(session.totalTokens || 0);
    const summary = topModels.find((model) => model.name === modelName);
    if (summary) {
      summary.inputTokens += Number(session.inputTokens || 0);
      summary.outputTokens += Number(session.outputTokens || 0);
    }
  }

  const labels = Array.from(byDay.keys()).sort();
  return {
    labels,
    models: topModels,
    series: topModels.map((model) => ({
      name: model.name,
      data: labels.map((label) => Number(byDay.get(label)?.[model.name] || 0)),
    })),
  };
}

export function getModelChartPalette(): string[] {
  return ["#3b82f6", "#10b981", "#f59e0b"];
}

export function getToolChartPalette(): string[] {
  return ["#4f8ff7", "#67c587", "#f3a64f", "#8c7cf7", "#ef6b73", "#4fc3d9"];
}

export function getStackSegmentRadius(
  seriesList: Array<{ name: string; data: number[] }>,
  datasetIndex: number,
  dataIndex: number,
): { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number } | number {
  const activeIndices = seriesList
    .map((series, index) => ({ index, value: Number(series.data?.[dataIndex] || 0) }))
    .filter((entry) => entry.value > 0)
    .map((entry) => entry.index);

  if (activeIndices.length === 0 || !activeIndices.includes(datasetIndex)) {
    return 0;
  }

  const first = activeIndices[0];
  const last = activeIndices[activeIndices.length - 1];

  if (first === last) {
    return { topLeft: 6, topRight: 6, bottomLeft: 6, bottomRight: 6 };
  }
  if (datasetIndex === first) {
    return { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 };
  }
  if (datasetIndex === last) {
    return { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 };
  }
  return 0;
}

export function formatSessionDate(timeStr: unknown): string {
  if (!timeStr) return "";
  const d = new Date(String(timeStr));
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function buildActivityMonthLabels(
  days: Array<{ key: string; value: number }>,
  leadingEmptyDays: number,
): Array<{ column: number; name: string }> {
  const labels: Array<{ column: number; name: string }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < days.length; index += 1) {
    const date = new Date(`${days[index].key}T00:00:00`);
    if (!Number.isFinite(date.getTime())) continue;
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    if (seen.has(monthKey)) continue;
    seen.add(monthKey);
    labels.push({
      column: Math.floor((leadingEmptyDays + index) / 7) + 1,
      name: date.toLocaleDateString(undefined, { month: "short" }),
    });
  }
  return labels;
}

export function overviewNote(totalTokens: unknown): string {
  const warAndPeaceTokens = 587000;
  const ratio = Math.max(1, Math.round(Number(totalTokens || 0) / warAndPeaceTokens));
  return `You've used ~${ratio}x more tokens than War and Peace.`;
}

export const STAT_ICONS: Record<string, string> = {
  "Total cost":
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5v13M11.5 4H6.75a2.25 2.25 0 0 0 0 4.5h2.5a2.25 2.25 0 0 1 0 4.5H4.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  Sessions:
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v6A1.5 1.5 0 0 1 12.5 10H9l-3 3v-3H3.5A1.5 1.5 0 0 1 2 8.5v-6z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>',
  Messages:
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5l-4 4V3z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="5.5" cy="6.5" r="1" fill="currentColor"/><circle cx="8" cy="6.5" r="1" fill="currentColor"/><circle cx="10.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  "Total tokens":
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="8" cy="4" rx="5.5" ry="2" stroke="currentColor" stroke-width="1.25"/><path d="M2.5 4v4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V4" stroke="currentColor" stroke-width="1.25"/><path d="M2.5 8v4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V8" stroke="currentColor" stroke-width="1.25"/></svg>',
  "Active days":
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.25"/><path d="M5 1v3M11 1v3M1 7h14" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><circle cx="5" cy="10.5" r="1" fill="currentColor"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/><circle cx="11" cy="10.5" r="1" fill="currentColor"/></svg>',
  "Current streak":
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1S4 5 4 9a4 4 0 0 0 8 0c0-4-4-8-4-8z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M8 11.5c-.83 0-1.5-.67-1.5-1.5S8 7.5 8 7.5s1.5 1 1.5 2.5-.67 1.5-1.5 1.5z" fill="currentColor"/></svg>',
  "Longest streak":
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 2.5h9v5.5a4.5 4.5 0 0 1-9 0V2.5z" stroke="currentColor" stroke-width="1.25"/><path d="M3.5 5.5H2a1.5 1.5 0 0 0 1.5 1.5M12.5 5.5H14a1.5 1.5 0 0 1-1.5 1.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M8 12.5v2M5.5 14.5h5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  "Peak hour":
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.25"/><path d="M8 4v4l3 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  Input:
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2v9M4.5 7.5 8 11l3.5-3.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 13.5h11" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  Output:
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 14V5M4.5 8.5 8 5l3.5 3.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 2.5h11" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  "Cache Read":
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.5 1.5 5 8.5h4.5L6.5 14.5l6-8.5H8l1.5-4.5z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>',
  "Cache Write":
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4a2 2 0 0 1 2-2h6l4 4v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z" stroke="currentColor" stroke-width="1.25"/><path d="M5 2v3.5h5V2M5 15v-4h6v4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  "Tool Calls":
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 1.5a3.5 3.5 0 0 1 .5 5.5L4 13.5a1.5 1.5 0 0 1-2-2L8.5 5A3.5 3.5 0 0 1 10 1.5z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="10.5" cy="3.5" r="1" fill="currentColor"/></svg>',
};
