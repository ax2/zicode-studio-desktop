import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { runWithRecent } from "../commandPalette/tool-access";
import { ToolCenterApp, type ToolCenterProps } from "./ToolCenterApp";
import type { ManualTool, ToolOpenRequest } from "./manual-tools";
export { mountResourceInputs } from "./resource-inputs";

export function mountToolCenter(container: HTMLElement, props: Omit<ToolCenterProps, "onOpen"> & { onError(error: unknown): void }) {
  const root = createRoot(container);
  let currentProps = props;
  let requestedTool: ToolOpenRequest | undefined;
  function render() { const { onError, ...viewProps } = currentProps; flushSync(() => root.render(createElement(ToolCenterApp, {
    ...viewProps,
    requestedTool,
    onOpen: entry => { void runWithRecent(entry, currentProps.accessStore, currentProps.scope).catch(onError); },
  }))); }
  render();
  return { destroy: () => root.unmount(),
    update: (nextProps: typeof props) => { currentProps = nextProps; render(); },
    openTool: (tool: ManualTool, revision: string) => { requestedTool = { tool, revision }; render(); } };
}
