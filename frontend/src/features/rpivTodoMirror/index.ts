import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { create } from "zustand";
import {
  RpivTodoMirrorPanelBridge,
  type RpivTodoStore,
} from "./RpivTodoMirrorApp";
import {
  cloneTodoState,
  EMPTY_STATE,
  isRpivTodoDetails,
  replayRpivTodoFromMessages,
  type RpivTodoDetails,
} from "./rpivTodoLogic";

export {
  isRpivTodoCommandNotify,
  isRpivTodoDetails,
  isRpivTodoWidgetRequest,
  replayRpivTodoFromMessages,
} from "./rpivTodoLogic";

let panelSequence = 0;

function createRpivTodoStore() {
  return create<RpivTodoStore>()((set) => ({
    tasks: [],
    expanded: false,
    toggleExpanded: () => {
      set((state) => ({ expanded: !state.expanded }));
      flushSync(() => {});
    },
  }));
}

export class RpivTodoMirrorPanel {
  private store: ReturnType<typeof createRpivTodoStore>;
  private root: Root;
  private element: HTMLElement;
  private listId = `rpiv-todo-list-${++panelSequence}`;

  constructor({ container }: { container?: HTMLElement | null } = {}) {
    this.store = createRpivTodoStore();
    this.element = document.createElement("div");
    this.element.dataset.rpivTodoRoot = "";
    container?.insertBefore(this.element, container.firstChild);
    this.root = createRoot(this.element);
    flushSync(() => {
      this.root.render(
        createElement(RpivTodoMirrorPanelBridge, {
          store: this.store,
          listId: this.listId,
        }),
      );
    });
  }

  private commit(patch: Partial<RpivTodoStore>): void {
    this.store.setState(patch);
    flushSync(() => {});
  }

  hydrateFromMessages(messages: Array<Record<string, unknown>> = []): void {
    this.setState(replayRpivTodoFromMessages(messages));
  }

  applyToolResult(result: { details?: unknown }): boolean {
    if (!isRpivTodoDetails(result?.details)) return false;
    this.setState(cloneTodoState(result.details));
    return true;
  }

  setState(state: RpivTodoDetails | null | undefined): void {
    this.commit({ tasks: cloneTodoState(state ?? EMPTY_STATE).tasks });
  }

  clear(): void {
    this.setState(EMPTY_STATE);
  }

  expand(): void {
    this.commit({ expanded: true });
  }

  dispose(): void {
    this.root.unmount();
    this.element.remove();
  }
}
