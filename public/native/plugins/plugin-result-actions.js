import { MULTI_PROJECT_UI_ENABLED } from "../workspace/workspace-mode.js";
// Trusted parent UI. References and grants never cross the plugin iframe bridge.

import { t } from "i18n";
import { createPluginResultTransfer } from "./plugin-result-transfer.js";
import { openSavedArtifact } from "../features/artifact-navigation.js";
import { appendResultCaptureNotice } from "./plugin-result-capture-notice.js";
import { createCsvResultExport, createJsonResultExport, createPngResultExport, createTextResultExport, createTsvResultExport } from "./text-result-export.js";
export function createPluginResultActions({ container, gateway, isCurrent, onReceiverExecuted, onOpenSaved = openSavedArtifact, sourceResultDisplayed = false }) {
  const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const panel = document.createElement("section");
  panel.className = "plugin-result-actions";
  panel.hidden = true;
  panel.setAttribute("aria-label", t("Studio result saving"));
  container.append(panel);
  let revision = 0;
  let current = null;
  let active = true;
  let transfer = null;
  let disposeCaptureNotice = null;
  const valid = (token) => active && token === revision && isCurrent(current?.scope);
  const reportExport = exporter(createTextResultExport, "reportReference");
  const pngExport = exporter(createPngResultExport, "pngReference");
  const csvExport = exporter(createCsvResultExport, "csvReference");
  const tsvExport = exporter(createTsvResultExport, "tsvReference");
  const jsonExport = exporter(createJsonResultExport, "jsonReference");
  const resultExports = [reportExport, pngExport, csvExport, tsvExport, jsonExport].filter(Boolean);

  function exporter(create, referenceKey) {
    return gateway.textExports ? create({
      api: gateway.textExports,
      getTarget: () => current?.scope,
      isCurrent: () => valid(revision) && Boolean(current?.[referenceKey]),
    }) : null;
  }

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
  function exportButton(controller, reference, label, token) {
    if (!controller || !reference) return null;
    const node = button(label, async () => {
      if (!valid(token) || node.disabled) return;
      node.disabled = true;
      try {
        await controller.open(reference, current.scope, container);
      } finally {
        if (valid(token)) node.disabled = false;
      }
    });
    return node;
  }

  function exportReference(reference, descriptor, mimeType) {
    return reference?.schemaVersion === 1 && uuidPattern.test(reference.resultId ?? "") &&
      descriptor?.mimeType === mimeType && /^[0-9a-f]{64}$/.test(descriptor.contentVersion ?? "") &&
      Number.isSafeInteger(descriptor.byteLength) && descriptor.byteLength > 0 && descriptor.byteLength <= 48 * 1024
      ? { ...descriptor, resultId: reference.resultId } : null;
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
          status.textContent = t("Could not prepare save. Check saved results and try again.");
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
    const report = exportButton(reportExport, current.reportReference,
      t(current.diffReport ? "Save diff report as text…" : "Save diagnostic JSON as…"), token);
    const png = exportButton(pngExport, current.pngReference, t("Save PNG as…"), token);
    const csv = exportButton(csvExport, current.csvReference, t("Save CSV as…"), token);
    const tsv = exportButton(tsvExport, current.tsvReference, t("Save TSV as…"), token);
    const json = exportButton(jsonExport, current.jsonReference, t("Save JSON as…"), token);
    const content = current.transferred ? element("pre", current.text) : null;
    content?.setAttribute("aria-label", t("Transferred result"));
    panel.replaceChildren(
      element(
        "strong",
        current.transferred ? t("Studio · Receiver result") : t("Studio · Save tool result"),
      ),
      ...[content, png, csv, tsv, json, title, preview, report, send, status].filter(Boolean),
    );
    if (current.saveOutcomeUnknown) {
      preview.disabled = true;
      status.textContent = t("Save outcome is uncertain. Check saved results before saving again; this view will not retry the write.");
    }
  }
  function show(response, scope, transferred = false) {
    revision += 1;
    for (const controller of resultExports) controller.clear();
    disposeCaptureNotice?.();
    disposeCaptureNotice = null;
    transfer?.destroy();
    const resultText = response?.resultRef?.mimeType === "application/json" && response?.result?.data && typeof response.result.data === "object"
      ? JSON.stringify(response.result.data)
      : typeof response?.result?.data?.text === "string"
      ? response.result.data.text
      : typeof response?.result?.text === "string"
        ? response.result.text
        : undefined;
    const httpResult = scope?.capabilityId === "service.http.get.v1" &&
      response?.operation === "http.get" && response.result != null;
    const reference = response?.resultRef;
    const diffReport = response?.result?.ok === true && scope?.pluginId === "com.zicode.devtools.compare" &&
      scope.capabilityId === "devtools.compare.text.diff";
    const reportReference = diffReport ? exportReference(reference, reference, "text/plain")
      : httpResult && reference?.schemaVersion === 1 &&
      reference.mimeType === "text/plain" && uuidPattern.test(reference.resultId ?? "") &&
      /^[0-9a-f]{64}$/.test(reference.contentVersion ?? "") &&
      Number.isSafeInteger(reference.byteLength) && reference.byteLength > 0 &&
      reference.byteLength <= 64 * 1024 ? { ...reference } : null;
    const computeOutput = scope?.pluginId === "com.zicode.devtools.compute" && response?.result?.ok === true;
    const independentQr = response?.result?.ok === true && scope?.pluginId === "com.zicode.devtools.qr" &&
      scope.capabilityId === "devtools.qr.png";
    const pngReference = independentQr || (computeOutput && scope.capabilityId === "devtools.compute.qr.png")
      ? exportReference(reference, reference?.pngExport, "image/png") : null;
    const independentMerge = response?.result?.ok === true && scope?.pluginId === "com.zicode.devtools.table-merge" &&
      /^devtools\.table-merge\.(left|inner|append|columns)$/.test(scope.capabilityId ?? "");
    const tableResult = independentMerge || (computeOutput && (scope.capabilityId?.startsWith("devtools.compute.transform.") ||
      /^devtools\.compute\.merge\.(left|inner|append|columns)$/.test(scope.capabilityId ?? "")));
    const workbench = computeOutput && /^devtools\.compute\.table\.(csv|json|query)$/.exec(scope.capabilityId ?? "")?.[1];
    const csvReference = tableResult || workbench === "csv" || workbench === "query"
      ? exportReference(reference, reference?.csvExport, "text/csv") : null;
    const tsvReference = workbench === "query"
      ? exportReference(reference, reference?.tsvExport, "text/tab-separated-values") : null;
    const qualityReport = computeOutput && /^devtools\.compute\.quality\.(json|csv|tsv)$/.test(scope.capabilityId ?? "");
    const compareJson = response?.result?.ok === true && scope?.pluginId === "com.zicode.devtools.compare" &&
      /^devtools\.compare\.json\.(path|diff\.(ordered|unordered))$/.test(scope.capabilityId ?? "");
    const jsonReference = tableResult || qualityReport || compareJson || workbench === "json" || workbench === "query"
      ? exportReference(reference, reference?.jsonExport, "application/json") : null;
    const successful = httpResult || response?.result?.ok === true ||
      (response?.operation === "model.generate" && typeof resultText === "string");
    current = response?.resultRef
      ? {
          scope,
          resultId: response.resultRef.resultId,
          reportReference,
          diffReport,
          pngReference,
          csvReference,
          tsvReference,
          jsonReference,
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
      // Receiver results are owned here even when the original source has a React result view.
      if (!httpResult && (!sourceResultDisplayed || transferred) && typeof resultText === "string") {
        const content = element("pre", resultText);
        if (transferred) content.setAttribute("aria-label", t("Transferred result"));
        panel.append(content);
      }
      disposeCaptureNotice = appendResultCaptureNotice(panel, response.resultCaptureError.code ?? "unknown");
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
            !uuidPattern.test(saved.artifact?.id ?? "")) throw new Error("invalid_save_receipt");
        panel.replaceChildren(element("p", t("Saved to results.")));
        panel.append(button(t("View saved artifact"), () => {
          if (valid(token)) onOpenSaved(saved.artifact.id, current.scope);
        }));
      } catch {
        if (valid(token)) {
          current.saveOutcomeUnknown = true;
          status.textContent = t("Save outcome is uncertain. Check saved results before saving again; this view will not retry the write.");
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
                if (outcome?.schemaVersion === 1 && outcome.status === "saved" && uuidPattern.test(outcome.artifactId ?? "")) {
                  panel.replaceChildren(element("p", t("Verified saved result.")),
                    button(t("View saved artifact"), () => { if (valid(token)) onOpenSaved(outcome.artifactId, current.scope); }));
                  return;
                }
                status.textContent = t("The save could not be verified. Check saved results before saving again; no write was retried.");
              } catch {
                if (valid(token)) status.textContent = t("The save could not be verified. Check saved results before saving again; no write was retried.");
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
      ...(MULTI_PROJECT_UI_ENABLED ? [element("p", t("Workspace: {workspace}").replace("{workspace}", preview.workspaceId))] : []),
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
      for (const controller of resultExports) controller.clear();
      disposeCaptureNotice?.();
      disposeCaptureNotice = null;
      transfer?.destroy();
      current = null;
      panel.hidden = true;
      panel.replaceChildren();
    },
    show,
    destroy() {
      active = false;
      for (const controller of resultExports) controller.destroy();
      disposeCaptureNotice?.();
      disposeCaptureNotice = null;
      transfer?.destroy();
      revision += 1;
      panel.remove();
    },
  };
}
