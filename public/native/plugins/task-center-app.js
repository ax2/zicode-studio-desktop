import { t } from "../../i18n.js";
import {
  markTaskCancelled,
  markTaskPaused,
  markTaskResumed,
  normalizeSuperAgentTasks,
} from "../../super-agent/task-state.js";

const FILTERS = ["all", "running", "paused", "needs_input", "failed", "done", "cancelled"];

export function setupTaskCenterApp({
  call,
  runtime,
  cancelRuntimeUi,
  openApp = () => {},
  notify = () => {},
  pollIntervalMs = 3000,
} = {}) {
  let tasks = [];
  let filter = "all";
  let loading = false;
  let error = null;
  let navigationRoot = null;
  let contentRoot = null;
  let pollTimer = null;

  async function load({ quiet = false } = {}) {
    if (loading || typeof call !== "function") return;
    loading = true;
    if (!quiet) render();
    try {
      const response = await call("read_super_agent_tasks");
      if (!response?.ok) throw new Error(t("Task service is unavailable"));
      tasks = normalizeSuperAgentTasks(response.data?.tasks ?? []);
      error = null;
    } catch (reason) {
      error = reason instanceof Error ? reason : new Error(String(reason));
    } finally {
      loading = false;
      renderNavigation();
      render();
    }
  }

  async function write(nextTasks, successMessage) {
    const response = await call("write_super_agent_tasks", { tasks: nextTasks });
    if (!response?.ok) throw new Error(t("Could not update task"));
    tasks = normalizeSuperAgentTasks(nextTasks);
    renderNavigation();
    render();
    if (successMessage) notify({ title: successMessage, type: "success" });
  }

  async function updateTask(taskId, updater, successMessage) {
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return;
    const next = [...tasks];
    next[index] = updater(next[index]);
    try {
      await write(next, successMessage);
    } catch (reason) {
      notify({ title: t("Could not update task"), message: reason.message, type: "error" });
    }
  }

  function childTarget(task) {
    const dispatch = task?.dispatch || {};
    if (!dispatch.childWorkspaceId || !dispatch.childSessionId || !dispatch.childInstanceId) return null;
    return {
      workspaceId: dispatch.childWorkspaceId,
      sessionId: dispatch.childSessionId,
      instanceId: dispatch.childInstanceId,
    };
  }

  async function stopTaskRuntime(task) {
    const target = childTarget(task);
    if (!target) {
      if (task.status === "running") throw new Error(t("The running task has not published a controllable session yet."));
      return;
    }
    if (!runtime?.request) throw new Error(t("Runtime control is unavailable"));
    await runtime.request({ type: "abort" }, target);
    await cancelRuntimeUi?.(target);
  }

  async function pauseTask(task) {
    try {
      await stopTaskRuntime(task);
      await updateTask(task.id, (current) => markTaskPaused(current), t("Task paused"));
    } catch (reason) {
      notify({ title: t("Could not pause task"), message: reason.message, type: "error" });
    }
  }

  async function cancelTask(task) {
    try {
      await stopTaskRuntime(task);
      await updateTask(task.id, (current) => markTaskCancelled(current), t("Task cancelled"));
    } catch (reason) {
      notify({ title: t("Could not cancel task"), message: reason.message, type: "error" });
    }
  }

  function renderNavigation(container = navigationRoot) {
    if (!container) return;
    navigationRoot = container;
    const nav = document.createElement("nav");
    nav.className = "task-center-navigation";
    nav.setAttribute("aria-label", t("Task filters"));
    for (const id of FILTERS) {
      const count = filteredTasks(id).length;
      const item = button(t(filterLabel(id)), () => {
        filter = id;
        renderNavigation();
        render();
      }, "task-center-filter");
      item.classList.toggle("active", filter === id);
      item.setAttribute("aria-pressed", String(filter === id));
      item.append(element("span", "task-center-filter-count", String(count)));
      nav.append(item);
    }
    container.replaceChildren(nav);
  }

  function renderContent(container = contentRoot) {
    if (!container) return;
    contentRoot = container;
    render();
    void load();
    startPolling();
  }

  function render() {
    if (!contentRoot) return;
    const main = document.createElement("div");
    main.className = "task-center-main";
    const header = document.createElement("header");
    header.className = "task-center-header";
    const heading = document.createElement("div");
    heading.append(
      element("h1", "", t("Task center")),
      element("p", "", t("Monitor background work, recover failures, and return to results.")),
    );
    const refresh = button(t("Refresh"), () => void load(), "ui-button ui-button--secondary");
    refresh.disabled = loading;
    header.append(heading, refresh);
    main.append(header, summary());
    if (error) {
      main.append(statePanel(t("Could not load tasks"), error.message, () => void load()));
    } else {
      const visible = filteredTasks(filter);
      if (!visible.length) {
        main.append(
          statePanel(
            t("No tasks in this view"),
            t("Background and delegated work will appear here automatically."),
          ),
        );
      } else {
        const list = document.createElement("div");
        list.className = "task-center-list";
        for (const task of visible) list.append(taskCard(task));
        main.append(list);
      }
    }
    contentRoot.replaceChildren(main);
  }

  function summary() {
    const row = document.createElement("div");
    row.className = "task-center-summary";
    for (const [label, count, tone] of [
      ["Running", filteredTasks("running").length, "running"],
      ["Needs input", filteredTasks("needs_input").length, "warning"],
      ["Failed", filteredTasks("failed").length, "danger"],
      ["Completed", filteredTasks("done").length, "success"],
    ]) {
      const card = document.createElement("article");
      card.className = `ui-card task-center-summary-card task-center-summary-card--${tone}`;
      card.append(element("strong", "", String(count)), element("span", "", t(label)));
      row.append(card);
    }
    return row;
  }

  function taskCard(task) {
    const card = document.createElement("article");
    card.className = `ui-panel task-center-card status-${task.status}`;
    const header = document.createElement("header");
    const title = document.createElement("div");
    title.append(
      element("span", "task-center-status", t(statusLabel(task.status))),
      element("h2", "", task.title || t("Untitled task")),
    );
    const actions = document.createElement("div");
    actions.className = "task-center-actions";
    if (task.dispatch?.childSessionId) {
      actions.append(
        button(t("Open session"), () => {
          document.dispatchEvent(new CustomEvent("sa-view-session", { detail: task }));
          openApp("core.chat");
        }, "ui-button ui-button--secondary ui-button--sm"),
      );
    }
    const retryLimitReached =
      Number.isFinite(Number(task.maxRetries)) && Number(task.retryCount || 0) >= Number(task.maxRetries);
    if (["failed", "blocked", "needs_input"].includes(task.status) && !retryLimitReached) {
      actions.append(
        button(
          t("Retry"),
          () =>
            void updateTask(
              task.id,
              (current) => ({
                ...current,
                status: "pending",
                retryCount: Number(current.retryCount || 0) + 1,
                result: { status: null, summary: null, completedAt: null, failReason: null },
                failReason: null,
              }),
              t("Task returned to pending"),
            ),
          "ui-button ui-button--primary ui-button--sm",
        ),
      );
    }
    if (task.status === "paused") {
      actions.append(
        button(
          t("Resume"),
          () => void updateTask(task.id, (current) => markTaskResumed(current), t("Task resumed")),
          "ui-button ui-button--primary ui-button--sm",
        ),
      );
    }
    if (task.status === "running") {
      actions.append(
        button(t("Pause"), () => void pauseTask(task), "ui-button ui-button--secondary ui-button--sm"),
      );
    }
    if (["pending", "running", "needs_input", "blocked"].includes(task.status)) {
      actions.append(
        button(
          t("Cancel"),
          () => void cancelTask(task),
          "ui-button ui-button--danger ui-button--sm",
        ),
      );
    }
    header.append(title, actions);
    card.append(header);
    if (task.description) card.append(element("p", "task-center-description", task.description));
    const detail = document.createElement("dl");
    appendDetail(detail, t("Project"), task.targetProject || task.dispatch?.targetProject || t("Not assigned"));
    appendDetail(detail, t("Started"), formatDate(task.dispatch?.startedAt));
    appendDetail(detail, t("Updated"), formatDate(task.events?.at(-1)?.at || task.result?.completedAt));
    if (task.budget) appendDetail(detail, t("Budget"), `$${Number(task.budget).toFixed(2)}`);
    if (task.maxRetries != null) {
      appendDetail(detail, t("Retries"), `${Number(task.retryCount || 0)} / ${Number(task.maxRetries)}`);
    }
    card.append(detail);
    if (retryLimitReached) card.append(element("p", "task-center-result", t("Retry limit reached")));
    const result = task.result?.summary || task.result?.failReason || task.failReason;
    if (result) card.append(element("p", "task-center-result", result));
    if (task.events?.length) {
      const history = document.createElement("details");
      history.append(element("summary", "", `${t("History")} (${task.events.length})`));
      const list = document.createElement("ol");
      for (const event of [...task.events].reverse().slice(0, 12)) {
        const item = document.createElement("li");
        item.append(element("time", "", formatDate(event.at)), element("span", "", event.message || event.status));
        list.append(item);
      }
      history.append(list);
      card.append(history);
    }
    return card;
  }

  function filteredTasks(id) {
    if (id === "all") return tasks;
    if (id === "running") return tasks.filter((task) => ["running", "pending"].includes(task.status));
    if (id === "needs_input") return tasks.filter((task) => ["needs_input", "blocked"].includes(task.status));
    return tasks.filter((task) => task.status === id);
  }

  function startPolling() {
    stopPolling();
    pollTimer = globalThis.setInterval(() => void load({ quiet: true }), pollIntervalMs);
  }

  function stopPolling() {
    if (pollTimer) globalThis.clearInterval(pollTimer);
    pollTimer = null;
  }

  return {
    renderNavigation,
    renderContent,
    deactivate: stopPolling,
    destroy: stopPolling,
    setTarget: () => {},
    handlesCommand: (commandId) => commandId === "tasks.open",
    executeCommand: () => openApp("com.zicode.tasks"),
    refresh: load,
  };
}

function filterLabel(filter) {
  return {
    all: "All tasks",
    running: "Running",
    paused: "Paused",
    needs_input: "Needs input",
    failed: "Failed",
    done: "Completed",
    cancelled: "Cancelled",
  }[filter];
}

function statusLabel(status) {
  return {
    pending: "Pending",
    running: "Running",
    paused: "Paused",
    needs_input: "Needs input",
    blocked: "Blocked",
    failed: "Failed",
    done: "Completed",
    cancelled: "Cancelled",
  }[status] || status;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text ?? "";
  return node;
}

function button(text, onClick, className) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  control.textContent = text;
  control.addEventListener("click", onClick);
  return control;
}

function statePanel(title, detail, retry) {
  const panel = document.createElement("section");
  panel.className = "ui-panel task-center-state";
  panel.append(element("h2", "", title), element("p", "", detail));
  if (retry) panel.append(button(t("Retry"), retry, "ui-button ui-button--primary"));
  return panel;
}

function appendDetail(list, term, value) {
  list.append(element("dt", "", term), element("dd", "", value || "—"));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
