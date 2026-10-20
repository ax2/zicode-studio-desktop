// Trusted parent UI. References and grants never cross the plugin iframe bridge.

import { t } from "i18n";
import { createPluginResultTransfer } from "./plugin-result-transfer.js";
import { openSavedArtifact } from "../features/artifact-navigation.js";
export function createPluginResultActions({ container, gateway, isCurrent, onReceiverExecuted, onOpenSaved = openSavedArtifact }) {
  const artifactIdPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const panel = document.createElement("section");
  panel.className = "plugin-result-actions";
  panel.hidden = true;
  panel.setAttribute("aria-label", t("Studio result saving"));
  container.append(panel);
  let revision = 0;
  let current = null;
  let active = true;
  let transfer = null;
  const valid = (token) => active && token === revision && isCurrent(current?.scope);

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, action) {
    const node = element("button", text, "ui-button");
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }
  function offer() {
    if (!current || !valid(revision)) return;
    transfer?.destroy();
    transfer = null;
    const token = revision;
    const title = element("input", null, "ui-input");
    title.value = current.title ?? t("{tool} result").replace("{tool}", current.scope.capabilityId);
    title.addEventListener("input", () => {
      if (valid(token)) current.title = title.value;
    });
    title.maxLength = 200;
    title.setAttribute("aria-label", t("Save title"));
    const status = element("p");
    status.setAttribute("role", "status");
    const preview = button(t("Preview save"), async () => {
      if (!valid(token) || current.saveOutcomeUnknown) return;
      preview.disabled = true;
      if (send) send.disabled = true;
      try {
        const response = await gateway.prepareSave(current.scope, current.resultId, title.value);
        if (!valid(token)) return;
        showPreview(response, token);
      } catch {
        if (valid(token)) {
          status.textContent = t("Could not prepare save. Review the current workspace and try again.");
          preview.disabled = false;
          if (send) send.disabled = false;
        }
      }
    });
    const send =
      typeof gateway.searchTargets === "function"
        ? button(t("Send to tool"), () => {
            transfer = createPluginResultTransfer({
              panel,
              gateway,
              source: current,
              isCurrent: () => valid(token),
              onCancel: offer,
              onResult: (response, scope) => {
                show(response, scope, true);
                const receivedRevision = revision;
                const stillReceived = () => active && receivedRevision === revision && isCurrent(scope);
                // A cached grant response is not a new execution. History failures must
                // never turn a successful transfer into a retryable computation error.
                if (response.replayed === true || !onReceiverExecuted) return;
                void Promise.resolve().then(() => {
                  if (stillReceived()) return onReceiverExecuted(scope);
                }).catch(() => {
                  if (stillReceived()) panel.append(element("p", t("Tool completed, but history could not be saved.")));
                });
              },
            });
          })
        : null;
    const content = current.transferred ? element("pre", current.text) : null;
    content?.setAttribute("aria-label", t("Transferred result"));
    panel.replaceChildren(
      element(
        "strong",
        current.transferred ? t("Studio · Receiver result") : t("Studio · Save tool result"),
      ),
      ...[content, title, preview, send, status].filter(Boolean),
    );
    if (current.saveOutcomeUnknown) {
      preview.disabled = true;
      status.textContent = t("Save outcome is uncertain. Check workspace artifacts before saving again; this view will not retry the write.");
    }
  }
  function show(response, scope, transferred = false) {
    revision += 1;
    transfer?.destroy();
    const resultText = response?.resultRef?.mimeType === "application/json" && response?.result?.data && typeof response.result.data === "object"
      ? JSON.stringify(response.result.data)
      : typeof response?.result?.data?.text === "string"
      ? response.result.data.text
      : typeof response?.result?.text === "string"
        ? response.result.text
        : undefined;
    const successful = response?.result?.ok === true ||
      (response?.operation === "model.generate" && typeof resultText === "string");
    current = response?.resultRef
      ? {
          scope,
          resultId: response.resultRef.resultId,
          transferred,
          text: resultText,
        }
      : null;
    panel.hidden = !current || !valid(revision);
    panel.replaceChildren();
    if (!active || !isCurrent(scope)) return;
    if (current) offer();
    else if (successful && response.resultCaptureError) {
      panel.hidden = false;
      if (typeof resultText === "string") panel.append(element("pre", resultText));
      panel.append(
        element(
          "p",
          t("Result cannot be reused or saved: {error}").replace(
            "{error}",
            response.resultCaptureError.code ?? "unknown",
          ),
        ),
      );
    }
  }
  function showPreview(response, token) {
    const preview = response.preview;
    const text = element("pre", preview.text);
    text.tabIndex = 0;
    const status = element("p");
    status.setAttribute("role", "status");
    const confirm = button(t("Confirm save"), async () => {
      if (!valid(token)) return;
      confirm.disabled = true;
      cancel.disabled = true;
      try {
        const saved = await gateway.commitSave(current.scope, response.grantId);
        if (!valid(token)) return;
        if (saved?.schemaVersion !== 1 || typeof saved.replayed !== "boolean" ||
            !artifactIdPattern.test(saved.artifact?.id ?? "")) throw new Error("invalid_save_receipt");
        panel.replaceChildren(element("p", t("Saved to the current workspace artifacts.")));
        panel.append(button(t("View saved artifact"), () => {
          if (valid(token)) onOpenSaved(saved.artifact.id, current.scope);
        }));
      } catch {
        if (valid(token)) {
          current.saveOutcomeUnknown = true;
          status.textContent = t("Save outcome is uncertain. Check workspace artifacts before saving again; this view will not retry the write.");
          confirm.remove();
          cancel.disabled = false;
          cancel.textContent = t("Close");
          if (typeof gateway.saveStatus === "function") {
            const check = button(t("Check save status"), () => { void verifySaveStatus(); });
            async function verifySaveStatus() {
              if (!valid(token) || check.disabled) return;
              check.disabled = true;
              status.textContent = t("Checking saved artifact…");
              try {
                const outcome = await gateway.saveStatus(current.scope, response.grantId);
                if (!valid(token)) return;
                if (outcome?.schemaVersion === 1 && outcome.status === "saved" && artifactIdPattern.test(outcome.artifactId ?? "")) {
                  panel.replaceChildren(element("p", t("Verified saved artifact in the current workspace.")),
                    button(t("View saved artifact"), () => { if (valid(token)) onOpenSaved(outcome.artifactId, current.scope); }));
                  return;
                }
                status.textContent = t("The save could not be verified. Check workspace artifacts before saving again; no write was retried.");
              } catch {
                if (valid(token)) status.textContent = t("The save could not be verified. Check workspace artifacts before saving again; no write was retried.");
              } finally {
                if (valid(token)) check.disabled = false;
              }
            }
            panel.insertBefore(check, cancel);
            void verifySaveStatus();
          }
        }
      }
    });
    const cancel = button(t("Cancel save"), () => {
      if (!valid(token)) return;
      offer();
      panel.querySelector("button")?.focus();
    });
    panel.replaceChildren(
      element("strong", t("Save preview: {title}").replace("{title}", preview.title)),
      ...(preview.mimeType === "application/json" ? [element("p", t("JSON object will be saved as application/json."))] : []),
      element(
        "p",
        t("New artifact · {bytes} bytes · plugin {version}")
          .replace("{bytes}", preview.byteLength)
          .replace("{version}", preview.packageVersion),
      ),
      element("p", t("Workspace: {workspace}").replace("{workspace}", preview.workspaceId)),
      text,
      confirm,
      cancel,
      status,
    );
    confirm.focus();
  }
  return {
    clear() {
      revision += 1;
      transfer?.destroy();
      current = null;
      panel.hidden = true;
      panel.replaceChildren();
    },
    show,
    destroy() {
      active = false;
      transfer?.destroy();
      revision += 1;
      panel.remove();
    },
  };
}
