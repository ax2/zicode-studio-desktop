import { t } from "../../i18n.js";

export function createBrowserModelGateway({ gateway, getTarget, isCurrent, openConversation }) {
  let owner, loaded = false;
  const key = value => JSON.stringify([value?.sceneId, value?.workspaceId, value?.instanceId, value?.sessionId]);
  const changed = () => Object.assign(new Error(t("Page or conversation changed. Read the page again.")), {
    code: "browser_model_context_changed",
  });
  async function request(operation, params = {}, initialize = false) {
    if (!isCurrent()) throw changed();
    if (initialize) loaded = false;
    if (initialize && getTarget()?.runtimeMode === "tools" && openConversation) {
      await openConversation({ target: getTarget(), isCurrent });
    }
    const target = getTarget();
    if (!isCurrent()) throw changed();
    if (!target?.sessionId || target.runtimeMode === "tools") {
      if (!initialize) throw changed();
      throw new Error(t("Open Chat to load Pi models, then return to this page."));
    }
    if (!initialize && (!loaded || key(target) !== key(owner))) throw changed();
    const identity = key(target);
    const result = await gateway.call(operation, params, { target, timeoutMs: 40_000 });
    if (!isCurrent() || key(getTarget()) !== identity) throw changed();
    if (!result?.ok) throw new Error(result?.error || "module_model_unavailable");
    // Keep the last verified owner for cancellation until a new lookup succeeds.
    if (initialize) { owner = { ...target }; loaded = true; }
    return result.data;
  }
  return {
    autoLoad: () => getTarget()?.runtimeMode === "ai",
    load: () => request("get_module_models", {}, true),
    save: (selection, expectedRevision) => request("save_module_model", { module: "browser", selection, expectedRevision }),
    ask: params => request("browser_model_request", params),
    cancel: requestId => owner ? gateway.call("cancel_browser_model_request", { requestId }, { target: owner }).catch(() => undefined) : Promise.resolve(),
  };
}
