const STORAGE_KEY = "zicode.dispatched-task-ownership.v1";
const MAX_ENTRIES = 128;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function runtimeTarget(value) {
  if (!value || typeof value !== "object") return null;
  const { workspaceId, sessionId, instanceId, sceneId } = value;
  if (![workspaceId, sessionId, instanceId].every(
    (id) => typeof id === "string" && id.length > 0 && id.length <= 160,
  )) return null;
  return {
    workspaceId,
    sessionId,
    instanceId,
    ...(typeof sceneId === "string" && sceneId.length <= 80 ? { sceneId } : {}),
  };
}

export function restoreDispatchOwnership(storage) {
  try {
    const store = storage ?? globalThis.sessionStorage;
    const parsed = JSON.parse(store?.getItem(STORAGE_KEY) || "null");
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return [];
    const now = Date.now();
    const ids = new Set();
    return parsed.entries.slice(0, MAX_ENTRIES).flatMap((item) => {
      const child = runtimeTarget(item?.child);
      const source = runtimeTarget(item?.source);
      const taskId = item?.taskId;
      if (
        !child || !source ||
        typeof taskId !== "string" || !taskId || taskId.length > 200 ||
        !Number.isFinite(item?.savedAt) || now - item.savedAt > MAX_AGE_MS ||
        item.savedAt > now + 60_000 || ids.has(child.instanceId)
      ) return [];
      ids.add(child.instanceId);
      return [{ taskId, child, source }];
    });
  } catch {
    return [];
  }
}

export function persistDispatchOwnership(instances, children, sources, storage) {
  try {
    const store = storage ?? globalThis.sessionStorage;
    const entries = [];
    for (const [instanceId, taskId] of instances) {
      const child = runtimeTarget(children.get(instanceId));
      const source = runtimeTarget(sources.get(instanceId));
      if (!child || child.instanceId !== instanceId || !source || !taskId) continue;
      entries.push({ taskId, child, source, savedAt: Date.now() });
    }
    const latest = entries.slice(-MAX_ENTRIES);
    if (latest.length) store?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries: latest }));
    else store?.removeItem(STORAGE_KEY);
  } catch {
    // A denied or full session store must not block task execution.
  }
}
