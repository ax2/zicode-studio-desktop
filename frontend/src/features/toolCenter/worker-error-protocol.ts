// Read fixed diagnostic strings from frozen Workers as protocol data.
// The views format user-facing recovery guidance in the selected locale.
export function isTextWorkerOutputLimit(code?: string, message?: string): boolean {
  // The frozen Text Worker also uses INPUT_TOO_LARGE for request and input budgets.
  return code === "INPUT_TOO_LARGE" && message === "结果超过 48 KiB";
}

const maxMessageLength = 48 * 1024;
const maxDataRows = 10_000;
const rowFailure = /^第 ([1-9][0-9]{0,4}) 行，列 ([\s\S]+) 转换失败；原数据未修改$/u;

export function dataTransformRowFailure(raw: string): { row: string; column: string } | null {
  if (raw.length > maxMessageLength) return null;
  try {
    const result = JSON.parse(raw) as { ok?: boolean; error?: { message?: unknown } } | null;
    const message = result?.error?.message;
    if (result?.ok !== false || typeof message !== "string") return null;
    const match = rowFailure.exec(message);
    return match && Number(match[1]) <= maxDataRows ? { row: match[1], column: match[2] } : null;
  } catch {
    return null;
  }
}
