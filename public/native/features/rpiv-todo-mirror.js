import { t } from "../../i18n.js";

const TODO_TOOL_NAME = "todo";
const TODO_WIDGET_KEY = "rpiv-todos";
let panelSequence = 0;
const EMPTY_STATE = Object.freeze({ tasks: Object.freeze([]), nextId: 1 });
const STATUS_LABELS = {
  pending: "pending",
  in_progress: "in progress",
  completed: "completed",
  deleted: "deleted",
};
const STATUS_GLYPHS = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
  deleted: "✗",
};

export function isRpivTodoWidgetRequest(request) {
  return request?.method === "setWidget" && request.widgetKey === TODO_WIDGET_KEY;
}

export function isRpivTodoCommandNotify(message) {
  const text = String(message ?? "");
  return (
    text === "No todos yet. Ask the agent to add some!" ||
    /^\d+\/\d+ completed/m.test(text) ||
    text.includes("── Pending ──") ||
    text.includes("── In Progress ──") ||
    text.includes("── Completed ──")
  );
}

export function isRpivTodoDetails(value) {
  if (!value || typeof value !== "object") return false;
  const details = value;
  if (!Array.isArray(details.tasks)) return false;
  if (typeof details.nextId !== "number") return false;
  return details.tasks.every(isRpivTodoTask);
}

function isRpivTodoTask(value) {
  if (!value || typeof value !== "object") return false;
  return (
    typeof value.id === "number" &&
    typeof value.subject === "string" &&
    ["pending", "in_progress", "completed", "deleted"].includes(value.status)
  );
}

export function replayRpivTodoFromMessages(messages = []) {
  let state = EMPTY_STATE;
  for (const message of messages) {
    if (message?.role !== "toolResult") continue;
    if (message.toolName !== TODO_TOOL_NAME) continue;
    if (!isRpivTodoDetails(message.details)) continue;
    state = cloneTodoState(message.details);
  }
  return state;
}

function cloneTodoState(details) {
  return {
    tasks: details.tasks.map((task) => ({ ...task })),
    nextId: details.nextId,
  };
}

export class RpivTodoMirrorPanel {
  #element;
  #listId = `rpiv-todo-list-${++panelSequence}`;
  #state = EMPTY_STATE;
  #onLocaleChange = () => this.#render();

  constructor({ container }) {
    this.#element = document.createElement("section");
    this.#element.className = "rpiv-todo-panel hidden is-collapsed";
    this.#element.setAttribute("role", "region");
    this.#element.setAttribute("aria-label", t("Pi task progress"));
    container?.insertBefore(this.#element, container.firstChild);
    window.addEventListener("zicode:locale-changed", this.#onLocaleChange);
  }

  hydrateFromMessages(messages) {
    this.setState(replayRpivTodoFromMessages(messages));
  }

  applyToolResult(result) {
    if (!isRpivTodoDetails(result?.details)) return false;
    this.setState(cloneTodoState(result.details));
    return true;
  }

  setState(state) {
    this.#state = state ?? EMPTY_STATE;
    this.#render();
  }

  clear() {
    this.setState(EMPTY_STATE);
  }

  expand() {
    this.#element.classList.add("is-expanded");
    this.#syncExpandedState();
  }

  dispose() {
    window.removeEventListener("zicode:locale-changed", this.#onLocaleChange);
    this.#element.remove();
  }

  #render() {
    const visibleTasks = this.#state.tasks.filter((task) => task.status !== "deleted");
    if (visibleTasks.length === 0) {
      this.#element.classList.remove("is-expanded");
      this.#element.classList.add("hidden");
      this.#element.replaceChildren();
      return;
    }

    const completed = visibleTasks.filter((task) => task.status === "completed").length;
    const total = visibleTasks.length;
    const hasActive = visibleTasks.some(
      (task) => task.status === "pending" || task.status === "in_progress",
    );

    this.#element.setAttribute("aria-label", t("Pi task progress"));
    const header = document.createElement("button");
    header.type = "button";
    header.className = "rpiv-todo-panel__header";
    const titleGroup = document.createElement("div");
    titleGroup.className = "rpiv-todo-panel__titleGroup";
    const dot = document.createElement("span");
    dot.className = `rpiv-todo-panel__dot ${hasActive ? "is-active" : ""}`;
    dot.textContent = hasActive ? "●" : "○";
    const title = document.createElement("span");
    title.className = "rpiv-todo-panel__title";
    title.textContent = t("Tasks");
    titleGroup.append(dot, title);
    const summary = document.createElement("span");
    summary.className = "rpiv-todo-panel__summary";
    summary.textContent = `${completed}/${total}`;
    const indicator = document.createElement("span");
    indicator.className = "rpiv-todo-panel__indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = "⌄";
    header.append(titleGroup, summary, indicator);
    header.addEventListener("click", () => {
      this.#element.classList.toggle("is-expanded");
      this.#syncExpandedState();
    });

    const displayTasks = selectDisplayTasks(visibleTasks);
    const list = document.createElement("ol");
    list.className = "rpiv-todo-panel__list";
    list.id = this.#listId;
    for (const task of displayTasks) {
      list.append(renderTask(task, shouldShowIds(visibleTasks)));
    }
    const children = [header, list];
    if (visibleTasks.length > displayTasks.length) {
      const more = document.createElement("div");
      more.className = "rpiv-todo-panel__more";
      more.textContent = t("More tasks: {count}").replace(
        "{count}",
        String(visibleTasks.length - displayTasks.length),
      );
      children.push(more);
    }

    this.#element.classList.toggle("is-complete", !hasActive);
    this.#element.replaceChildren(...children);
    this.#element.classList.remove("hidden");
    this.#syncExpandedState();
  }

  #syncExpandedState() {
    const button = this.#element.querySelector(".rpiv-todo-panel__header");
    if (!button) return;
    const expanded = this.#element.classList.contains("is-expanded");
    const completed = this.#state.tasks.filter((task) => task.status === "completed").length;
    const total = this.#state.tasks.filter((task) => task.status !== "deleted").length;
    const action = t(expanded ? "Hide task details" : "Show task details");
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-controls", this.#listId);
    button.setAttribute(
      "aria-label",
      t("{action}. {completed}/{total} complete")
        .replace("{action}", action)
        .replace("{completed}", String(completed))
        .replace("{total}", String(total)),
    );
    button.title = action;
    for (const detail of this.#element.querySelectorAll(
      ".rpiv-todo-panel__list, .rpiv-todo-panel__more",
    )) {
      detail.setAttribute("aria-hidden", String(!expanded));
      detail.toggleAttribute("inert", !expanded);
    }
    const indicator = button.querySelector(".rpiv-todo-panel__indicator");
    if (indicator) indicator.textContent = expanded ? "⌃" : "⌄";
  }
}

function shouldShowIds(tasks) {
  return tasks.some((task) => Array.isArray(task.blockedBy) && task.blockedBy.length > 0);
}

function selectDisplayTasks(tasks) {
  const maxRows = 5;
  const active = tasks.filter((task) => task.status !== "completed");
  const completed = tasks.filter((task) => task.status === "completed");
  return [...active, ...completed].slice(0, maxRows);
}

function renderTask(task, showId) {
  const item = document.createElement("li");
  item.className = `rpiv-todo-panel__task is-${task.status.replace("_", "-")}`;

  const glyph = document.createElement("span");
  glyph.className = "rpiv-todo-panel__glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = STATUS_GLYPHS[task.status] ?? "•";

  const text = document.createElement("span");
  text.className = "rpiv-todo-panel__text";
  text.textContent = `${showId ? `#${task.id} ` : ""}${task.subject}`;

  item.append(glyph, text);

  if (task.status === "in_progress" && task.activeForm) {
    const active = document.createElement("span");
    active.className = "rpiv-todo-panel__meta";
    active.textContent = `(${task.activeForm})`;
    item.append(active);
  }

  if (Array.isArray(task.blockedBy) && task.blockedBy.length > 0) {
    const blocked = document.createElement("span");
    blocked.className = "rpiv-todo-panel__meta";
    blocked.textContent = `⛓ ${task.blockedBy.map((id) => `#${id}`).join(",")}`;
    item.append(blocked);
  }

  const status = t(STATUS_LABELS[task.status] ?? task.status);
  item.title = status;
  item.setAttribute("aria-label", `${task.subject}, ${status}`);
  return item;
}
