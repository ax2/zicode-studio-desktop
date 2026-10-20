import { t } from "i18n";
import { createPluginResultActions } from "./plugin-result-actions.js";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function setupChatPluginResultActions({ messages, gateway, getTarget }) {
  const host = document.createElement("section");
  host.className = "chat-plugin-result-holder";
  host.hidden = true;
  host.setAttribute("aria-label", t("Use plugin result"));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ui-button ui-button--ghost";
  close.textContent = t("Close");
  host.append(close);
  messages.after(host);
  let binding = null;
  const current = (scope) => {
    const target = getTarget();
    return host.isConnected && !host.hidden && binding && target &&
      target.instanceId === binding.instanceId && target.sessionId === binding.sessionId &&
      target.workspaceId === scope?.workspaceId &&
      (target.sceneId ?? "programming") === scope?.sceneId;
  };
  const actions = createPluginResultActions({ container: host, gateway, isCurrent: current });
  const hide = () => {
    actions.clear();
    binding = null;
    host.hidden = true;
  };
  close.addEventListener("click", hide);

  function onResult(event) {
    const detail = event.detail;
    const ref = detail?.resultRef;
    const result = detail?.result;
    const target = getTarget();
    if (!target?.workspaceId || !target?.sessionId || !target?.instanceId ||
        result?.ok !== true || !((ref?.schemaVersion === 1 && ref.mimeType === "text/plain") ||
          (ref?.schemaVersion === 2 && ref.mimeType === "application/json")) ||
        !UUID.test(ref.resultId ?? "") ||
        typeof detail.pluginId !== "string" || !detail.pluginId ||
        typeof detail.capabilityId !== "string" || !detail.capabilityId) return;
    binding = { instanceId: target.instanceId, sessionId: target.sessionId };
    host.setAttribute("aria-label", t("Use plugin result"));
    close.textContent = t("Close");
    host.hidden = false;
    actions.show({ result, resultRef: ref }, {
      workspaceId: target.workspaceId,
      sceneId: target.sceneId ?? "programming",
      pluginId: detail.pluginId,
      capabilityId: detail.capabilityId,
    });
    close.focus();
  }
  messages.addEventListener("pluginresultaction", onResult);
  return {
    clear: hide,
    destroy() {
      messages.removeEventListener("pluginresultaction", onResult);
      actions.destroy();
      host.remove();
    },
  };
}
