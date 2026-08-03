import { t } from "../../i18n.js";

const FILTERS = ["all", "enabled", "approval", "history"];

export function nextAutomationRun(workflow, from = new Date()) {
  if (!workflow?.enabled || workflow.schedule === "manual") return null;
  const base = new Date(from);
  if (workflow.schedule === "interval") {
    const minutes = Math.max(5, Number(workflow.intervalMinutes) || 60);
    return new Date(base.getTime() + minutes * 60_000).toISOString();
  }
  const [hour, minute] = String(workflow.dailyTime || "09:00")
    .split(":")
    .map(Number);
  const next = new Date(base);
  next.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
  if (next <= base) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export function isAutomationDue(workflow, now = new Date()) {
  if (!workflow?.enabled || workflow.schedule === "manual" || workflow.approvalPending) return false;
  if (!workflow.nextRunAt) return true;
  const next = new Date(workflow.nextRunAt).getTime();
  return Number.isFinite(next) && next <= new Date(now).getTime();
}

export function setupAutomationApp({
  call,
  getTarget = () => null,
  openApp = () => {},
  notify = () => {},
  pollIntervalMs = 60_000,
} = {}) {
  let workflows = [];
  let filter = "all";
  let navigationRoot = null;
  let contentRoot = null;
  let loading = false;
  let error = null;
  let pollTimer = null;
  let ticking = false;

  async function load({ renderAfter = true } = {}) {
    if (loading || typeof call !== "function") return workflows;
    loading = true;
    try {
      const response = await call("automation_workspace", { action: "list" });
      if (!response?.ok) throw new Error(response?.error || t("Automation service is unavailable"));
      workflows = response.data?.workflows ?? [];
      error = null;
      return workflows;
    } catch (reason) {
      error = reason instanceof Error ? reason : new Error(String(reason));
      return workflows;
    } finally {
      loading = false;
      if (renderAfter) {
        renderNavigation();
        render();
      }
    }
  }

  async function saveWorkflow(workflow) {
    const response = await call("automation_workspace", { action: "upsert", workflow });
    if (!response?.ok) throw new Error(response?.error || t("Could not save automation"));
    workflows = response.data?.workspace?.workflows ?? workflows;
    renderNavigation();
    render();
    return response.data?.workflow;
  }

  async function recordRun(workflow, run, { approvalPending = false, nextRunAt } = {}) {
    const response = await call("automation_workspace", {
      action: "record_run",
      id: workflow.id,
      run,
      approvalPending,
      nextRunAt: nextRunAt ?? workflow.nextRunAt,
    });
    if (!response?.ok) throw new Error(response?.error || t("Could not update automation history"));
    workflows = response.data?.workspace?.workflows ?? workflows;
  }

  async function enqueue(workflow, trigger = "manual") {
    const taskResponse = await call("read_super_agent_tasks");
    if (!taskResponse?.ok) throw new Error(taskResponse?.error || t("Task service is unavailable"));
    const taskId = `automation-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const task = {
      id: taskId,
      title: workflow.title,
      description: workflow.prompt,
      targetProject: workflow.targetProject || getTarget?.()?.cwd || null,
      status: "pending",
      source: { channel: "automation", conversationId: workflow.id, userId: null, messageId: null },
      automation: { workflowId: workflow.id, trigger },
      budget: workflow.maxCost || null,
      maxRetries: workflow.maxRetries ?? 2,
      retryCount: 0,
      events: [{ at: now, type: "queued", status: "pending", message: `Queued by automation (${trigger}).` }],
    };
    const tasks = [...(taskResponse.data?.tasks ?? []), task];
    const write = await call("write_super_agent_tasks", { tasks });
    if (!write?.ok) throw new Error(write?.error || t("Could not queue automation task"));
    await recordRun(
      workflow,
      { status: "queued", startedAt: now, taskId, message: t("Queued in Task center") },
      { approvalPending: false, nextRunAt: nextAutomationRun(workflow, new Date(now)) },
    );
    notify({ title: t("Automation queued"), message: workflow.title, type: "success" });
  }

  async function runWorkflow(workflow, trigger = "manual") {
    try {
      await enqueue(workflow, trigger);
      await load();
    } catch (reason) {
      notify({ title: t("Could not run automation"), message: reason.message, type: "error" });
    }
  }

  async function tick() {
    if (ticking || typeof call !== "function") return;
    ticking = true;
    try {
      const current = await load({ renderAfter: false });
      await reconcileRuns(current);
      for (const workflow of current.filter((item) => isAutomationDue(item))) {
        const now = new Date().toISOString();
        if (workflow.requireApproval) {
          await recordRun(
            workflow,
            { status: "approval_required", startedAt: now, taskId: null, message: t("Waiting for approval") },
            { approvalPending: true, nextRunAt: workflow.nextRunAt || now },
          );
          notify({ title: t("Automation needs approval"), message: workflow.title, type: "warning" });
        } else {
          await enqueue(workflow, "schedule");
        }
      }
    } catch {
      // Scheduler failures remain visible on the next manual refresh without interrupting Chat.
    } finally {
      ticking = false;
      renderNavigation();
      render();
    }
  }

  async function reconcileRuns(current) {
    const tracked = current.filter((workflow) =>
      ["queued", "retry_queued"].includes(workflow.history?.[0]?.status),
    );
    if (!tracked.length) return;
    const response = await call("read_super_agent_tasks");
    if (!response?.ok) return;
    const tasks = [...(response.data?.tasks ?? [])];
    let tasksChanged = false;
    const updates = [];
    for (const workflow of tracked) {
      const lastRun = workflow.history[0];
      const index = tasks.findIndex((task) => task.id === lastRun.taskId);
      if (index < 0) continue;
      const task = tasks[index];
      if (task.status === "done") {
        updates.push({
          workflow,
          run: {
            status: "completed",
            startedAt: new Date().toISOString(),
            taskId: task.id,
            message: task.result?.summary || t("Task completed"),
          },
        });
      } else if (task.status === "failed" && Number(task.retryCount || 0) < Number(workflow.maxRetries || 0)) {
        const now = new Date().toISOString();
        tasks[index] = {
          ...task,
          status: "pending",
          retryCount: Number(task.retryCount || 0) + 1,
          failReason: null,
          result: { status: null, summary: null, completedAt: null, failReason: null },
          events: [
            ...(task.events || []),
            { at: now, type: "automation_retry", status: "pending", message: t("Automatically queued for retry") },
          ],
        };
        tasksChanged = true;
        updates.push({
          workflow,
          run: { status: "retry_queued", startedAt: now, taskId: task.id, message: t("Automatically queued for retry") },
        });
      } else if (task.status === "failed") {
        updates.push({
          workflow,
          run: {
            status: "failed",
            startedAt: new Date().toISOString(),
            taskId: task.id,
            message: task.result?.failReason || task.failReason || t("Retry limit reached"),
          },
        });
      }
    }
    if (tasksChanged) await call("write_super_agent_tasks", { tasks });
    for (const update of updates) {
      await recordRun(update.workflow, update.run, {
        approvalPending: false,
        nextRunAt: update.workflow.nextRunAt,
      });
    }
  }

  function startScheduler() {
    if (pollTimer) return;
    pollTimer = globalThis.setInterval(() => void tick(), pollIntervalMs);
    void tick();
  }

  function renderNavigation(container = navigationRoot) {
    if (!container) return;
    navigationRoot = container;
    const nav = document.createElement("nav");
    nav.className = "automation-navigation";
    for (const id of FILTERS) {
      const control = button(t(filterLabel(id)), () => {
        filter = id;
        renderNavigation();
        render();
      }, "automation-nav-item");
      control.classList.toggle("active", filter === id);
      control.append(element("span", "automation-nav-count", String(filtered(id).length)));
      nav.append(control);
    }
    container.replaceChildren(nav);
  }

  function renderContent(container = contentRoot) {
    if (!container) return;
    contentRoot = container;
    render();
    void load();
    startScheduler();
  }

  function render() {
    if (!contentRoot) return;
    const main = element("div", "automation-main", "");
    const header = element("header", "automation-header", "");
    const heading = element("div", "", "");
    heading.append(element("h1", "", t("Automation center")), element("p", "", t("Schedule repeatable work with explicit approvals and task history.")));
    header.append(heading, button(t("Refresh"), () => void load(), "ui-button ui-button--secondary"));
    main.append(header, workflowForm());
    if (error) main.append(statePanel(t("Could not load automations"), error.message));
    else {
      const visible = filtered(filter);
      if (!visible.length) main.append(statePanel(t("No automations in this view"), t("Create a workflow to turn repeated prompts into auditable tasks.")));
      else {
        const list = element("div", "automation-list", "");
        for (const workflow of visible) list.append(workflowCard(workflow));
        main.append(list);
      }
    }
    contentRoot.replaceChildren(main);
  }

  function workflowForm() {
    const form = element("form", "ui-panel automation-form", "");
    form.append(element("h2", "", t("New automation")));
    const title = input(t("Name"), "text", true);
    const targetProject = input(t("Target project"), "text", false, getTarget?.()?.cwd || "");
    const prompt = textarea(t("Task instructions"));
    const schedule = select([
      ["manual", t("Manual")],
      ["interval", t("Every hour")],
      ["daily", t("Daily at 09:00")],
    ]);
    const approval = checkbox(t("Require approval before every run"), true);
    const limits = element("div", "automation-form-limits", "");
    const maxCost = input(t("Maximum cost per run"), "number", false);
    maxCost.min = "0";
    maxCost.step = "0.01";
    const maxRetries = input(t("Maximum retries"), "number", false, "2");
    maxRetries.min = "0";
    maxRetries.max = "10";
    limits.append(
      labeledControl(t("Maximum cost per run"), maxCost),
      labeledControl(t("Maximum retries"), maxRetries),
    );
    form.append(
      labeledControl(t("Name"), title),
      labeledControl(t("Target project"), targetProject),
      labeledControl(t("Task instructions"), prompt),
      labeledControl(t("Schedule"), schedule),
      limits,
      approval,
    );
    const submit = button(t("Create automation"), null, "ui-button ui-button--primary");
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const scheduleValue = schedule.value;
        const saved = await saveWorkflow({
          title: title.value,
          targetProject: targetProject.value,
          prompt: prompt.value,
          schedule: scheduleValue,
          intervalMinutes: scheduleValue === "interval" ? 60 : null,
          dailyTime: scheduleValue === "daily" ? "09:00" : null,
          requireApproval: approval.querySelector("input").checked,
          maxCost: maxCost.value ? Number(maxCost.value) : null,
          maxRetries: Number(maxRetries.value || 0),
          enabled: true,
        });
        if (saved?.schedule !== "manual" && !saved.nextRunAt) {
          await saveWorkflow({ ...saved, nextRunAt: nextAutomationRun(saved) });
        }
        form.reset();
        approval.querySelector("input").checked = true;
        notify({ title: t("Automation created"), type: "success" });
      } catch (reason) {
        notify({ title: t("Could not save automation"), message: reason.message, type: "error" });
      } finally {
        submit.disabled = false;
      }
    });
    return form;
  }

  function workflowCard(workflow) {
    const card = element("article", "ui-panel automation-card", "");
    const header = element("header", "", "");
    const heading = element("div", "", "");
    heading.append(element("span", "ui-badge", t(workflow.approvalPending ? "Approval required" : workflow.enabled ? "Enabled" : "Disabled")), element("h2", "", workflow.title));
    const actions = element("div", "automation-actions", "");
    if (workflow.approvalPending) actions.append(button(t("Approve and run"), () => void runWorkflow(workflow, "approval"), "ui-button ui-button--primary ui-button--sm"));
    else actions.append(button(t("Run now"), () => void runWorkflow(workflow), "ui-button ui-button--primary ui-button--sm"));
    actions.append(button(t(workflow.enabled ? "Disable" : "Enable"), () => void saveWorkflow({ ...workflow, enabled: !workflow.enabled, nextRunAt: !workflow.enabled ? nextAutomationRun({ ...workflow, enabled: true }) : null }), "ui-button ui-button--secondary ui-button--sm"));
    actions.append(button(t("Remove"), () => void removeWorkflow(workflow.id), "ui-button ui-button--ghost ui-button--sm"));
    header.append(heading, actions);
    card.append(header, element("p", "automation-prompt", workflow.prompt));
    const details = element("dl", "", "");
    appendDetail(details, t("Schedule"), scheduleLabel(workflow));
    appendDetail(details, t("Next run"), formatDate(workflow.nextRunAt));
    appendDetail(details, t("Target project"), workflow.targetProject || t("Current project"));
    card.append(details);
    if (workflow.history?.length) {
      const history = element("details", "automation-history", "");
      history.append(element("summary", "", `${t("Run history")} (${workflow.history.length})`));
      const list = document.createElement("ol");
      for (const run of workflow.history.slice(0, 12)) {
        const item = document.createElement("li");
        item.append(element("time", "", formatDate(run.startedAt)), element("span", "ui-badge", t(run.status)), element("span", "", run.message || run.taskId || ""));
        list.append(item);
      }
      history.append(list);
      card.append(history);
    }
    return card;
  }

  async function removeWorkflow(id) {
    const response = await call("automation_workspace", { action: "remove", id });
    if (!response?.ok) {
      notify({ title: t("Could not remove automation"), message: response?.error, type: "error" });
      return;
    }
    workflows = response.data?.workflows ?? [];
    renderNavigation();
    render();
  }

  function filtered(id) {
    if (id === "all") return workflows;
    if (id === "enabled") return workflows.filter((workflow) => workflow.enabled);
    if (id === "approval") return workflows.filter((workflow) => workflow.approvalPending);
    return workflows.filter((workflow) => workflow.history?.length);
  }

  startScheduler();
  return {
    renderNavigation,
    renderContent,
    setTarget: () => render(),
    handlesCommand: (commandId) => commandId === "automation.open",
    executeCommand: () => openApp("com.zicode.automation"),
    refresh: load,
    tick,
    destroy() {
      if (pollTimer) globalThis.clearInterval(pollTimer);
      pollTimer = null;
    },
  };
}

function filterLabel(id) {
  return { all: "All automations", enabled: "Enabled", approval: "Needs approval", history: "Run history" }[id];
}

function scheduleLabel(workflow) {
  if (workflow.schedule === "interval") return `${t("Every")} ${workflow.intervalMinutes} ${t("minutes")}`;
  if (workflow.schedule === "daily") return `${t("Daily at")} ${workflow.dailyTime}`;
  return t("Manual");
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
  if (onClick) control.addEventListener("click", onClick);
  return control;
}

function input(placeholder, type, required, value = "") {
  const control = document.createElement("input");
  control.className = "ui-input";
  control.type = type;
  control.placeholder = placeholder;
  control.required = required;
  control.value = value;
  return control;
}

function textarea(placeholder) {
  const control = document.createElement("textarea");
  control.className = "ui-textarea";
  control.rows = 4;
  control.placeholder = placeholder;
  control.required = true;
  return control;
}

function select(options) {
  const control = document.createElement("select");
  control.className = "ui-select";
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    control.append(option);
  }
  return control;
}

function checkbox(label, checked) {
  const wrapper = element("label", "automation-checkbox", "");
  const control = document.createElement("input");
  control.type = "checkbox";
  control.checked = checked;
  wrapper.append(control, element("span", "", label));
  return wrapper;
}

function labeledControl(label, control) {
  const wrapper = element("label", "automation-field", "");
  wrapper.append(element("span", "automation-field-label", label), control);
  return wrapper;
}

function appendDetail(list, term, value) {
  list.append(element("dt", "", term), element("dd", "", value || "—"));
}

function statePanel(title, detail) {
  const panel = element("section", "ui-panel automation-state", "");
  panel.append(element("h2", "", title), element("p", "", detail));
  return panel;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
