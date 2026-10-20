export function createPluginTaskOverviewClient(hostFetch) {
  return async (workspaceId, before) => {
    const response = await hostFetch("/v2/plugin-task-center/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        workspaceId,
        limit: 30,
        ...(before ? { before } : {}),
      }),
    });
    if (!response.ok) throw new Error("plugin_task_overview_unavailable");
    const payload = await response.json();
    if (
      payload?.schemaVersion !== 1 ||
      payload?.operation !== "plugin-tasks.workspace.list" ||
      !Array.isArray(payload?.page?.tasks)
    ) {
      throw new Error("plugin_task_overview_invalid");
    }
    return payload.page;
  };
}

export function createPluginTaskDetailClient(hostFetch) {
  return async (workspaceId, taskRef, beforeSequence) => {
    const response = await hostFetch("/v2/plugin-task-center/detail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, workspaceId, taskRef,
        ...(beforeSequence === undefined ? {} : { beforeSequence }) }),
    });
    if (!response.ok) throw new Error("plugin_task_detail_unavailable");
    const payload = await response.json();
    if (payload?.schemaVersion !== 1 ||
      payload?.operation !== "plugin-tasks.workspace.detail" ||
      payload?.detail?.snapshot?.taskRef !== taskRef ||
      !Array.isArray(payload?.detail?.events) ||
      (beforeSequence !== undefined && (
        !Number.isSafeInteger(beforeSequence) || beforeSequence <= 0 ||
        payload.detail.events.some(event => !Number.isSafeInteger(event.sequence) ||
          event.sequence <= 0 || event.sequence >= beforeSequence)
      ))) {
      throw new Error("plugin_task_detail_invalid");
    }
    return payload.detail;
  };
}
