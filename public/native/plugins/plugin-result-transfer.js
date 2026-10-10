// Runs in Studio's trusted parent, never in the plugin iframe.
import { t } from "i18n";
import { showTransferInputs, transferInputsPreview } from "./plugin-transfer-inputs.js";
export function createPluginResultTransfer({
  panel,
  gateway,
  source,
  isCurrent,
  onCancel,
  onResult,
}) {
  let active = true;
  let sequence = 0;
  let query = "";
  let revision = null;
  const valid = (token) => active && token === sequence && isCurrent();
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action) => {
    const node = element("button", text, "ui-button");
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  };
  const cancel = () => {
    if (!active || !isCurrent()) return;
    active = false;
    sequence += 1;
    onCancel();
  };
  const collect = (target, inputs = {}) => {
    if (!active || !isCurrent()) return;
    sequence += 1;
    showTransferInputs({ panel, target, inputs, onCancel: cancel,
      onPreview: (values) => void prepare(target, values) });
  };

  async function search(offset = 0) {
    if (!active || !isCurrent()) return;
    const token = ++sequence;
    const searchInput = element("input", null, "ui-input");
    searchInput.type = "search";
    searchInput.value = query;
    searchInput.setAttribute("aria-label", t("Search receiver tools"));
    searchInput.maxLength = 256;
    const status = element("p", t("Finding compatible tools…"));
    status.setAttribute("role", "status");
    const list = element("div");
    list.className = "plugin-result-target-list";
    const submit = () => {
      query = searchInput.value;
      revision = null;
      void search();
    };
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
    panel.replaceChildren(
      element("strong", t("Send to tool")),
      element(
        "p",
        t(
          "Choose a receiver and field. Preview does not execute; confirmation starts local computation.",
        ),
      ),
      searchInput,
      button(t("Search tools"), submit),
      button(t("Cancel transfer"), cancel),
      status,
      list,
    );
    try {
      const page = await gateway.searchTargets(
        source.scope,
        source.resultId,
        query,
        offset,
        revision,
      );
      if (!valid(token)) return;
      revision = page.revision;
      status.textContent = t("Compatible mappings: {total} · showing {start}–{end}")
        .replace("{total}", page.total)
        .replace("{start}", offset + (page.items.length ? 1 : 0))
        .replace("{end}", offset + page.items.length);
      for (const target of page.items) {
        list.append(
          button(
            t("{title} · {plugin} · field {field}")
              .replace("{title}", target.title)
              .replace("{plugin}", target.pluginId)
              .replace("{field}", target.field),
            () => {
              if (target.requiredInputs?.length) {
                collect(target);
              } else void prepare(target);
            },
          ),
        );
      }
      if (offset > 0)
        list.append(button(t("Previous tool page"), () => void search(Math.max(0, offset - 20))));
      if (page.nextOffset !== null)
        list.append(button(t("Next tool page"), () => void search(page.nextOffset)));
      if (!page.items.length)
        list.append(
          element(
            "p",
            t(
              "No matching tools. Currently supports local WASI computation with string fields.",
            ),
          ),
        );
    } catch (error) {
      if (valid(token))
        status.textContent = t("Could not search receiver tools: {error}").replace(
          "{error}",
          error.message,
        );
    }
  }

  async function prepare(target, inputs = {}) {
    if (!active || !isCurrent()) return;
    const token = ++sequence;
    const status = element("p", t("Preparing field mapping preview…"));
    status.setAttribute("role", "status");
    panel.replaceChildren(status, button(t("Cancel transfer"), cancel));
    try {
      const response = await gateway.prepareTransfer(
        source.scope,
        source.resultId,
        { pluginId: target.pluginId, capabilityId: target.capabilityId },
        target.field,
        inputs,
      );
      if (!valid(token)) return;
      const preview = response.preview;
      const text = element("pre", preview.text);
      text.setAttribute("aria-label", t("Transfer data preview"));
      text.tabIndex = 0;
      const confirm = button(t("Confirm transfer and run"), async () => {
        if (!valid(token)) return;
        confirm.disabled = true;
        cancelButton.disabled = true;
        status.textContent = t("Running receiver tool…");
        try {
          const result = await gateway.commitTransfer(source.scope, response.grantId);
          if (!valid(token)) return;
          if (result.error || result.result?.ok !== true) {
            status.textContent = t("Receiver tool failed: {error}").replace(
              "{error}",
              result.error?.code ?? result.result?.error?.code ?? "unknown",
            );
            cancelButton.disabled = false;
            return;
          }
          active = false;
          onResult(result, {
            ...source.scope,
            pluginId: target.pluginId,
            capabilityId: target.capabilityId,
          });
        } catch (error) {
          if (valid(token)) {
            status.textContent = t("Transfer failed: {error}").replace("{error}", error.message);
            confirm.disabled = false;
            cancelButton.disabled = false;
          }
        }
      });
      const cancelButton = button(t("Cancel transfer"), cancel);
      status.textContent = t(
        "Confirm to send this data to the selected tool. It will not be saved or sent to a model automatically.",
      );
      panel.replaceChildren(
        element("strong", t("Transfer preview")),
        element(
          "p",
          t("Receiver: {title} · {plugin} · {version}")
            .replace("{title}", target.title)
            .replace("{plugin}", preview.target.pluginId)
            .replace("{version}", preview.target.packageVersion),
        ),
        element(
          "p",
          t("Field: {field} · {bytes} bytes · workspace: {workspace}")
            .replace("{field}", preview.field)
            .replace("{bytes}", preview.byteLength)
            .replace("{workspace}", preview.workspaceId),
        ),
        text,
        transferInputsPreview(preview.inputs),
        confirm,
        cancelButton,
        status,
      );
      confirm.focus();
    } catch (error) {
      if (valid(token)) {
        status.textContent = t("Could not prepare transfer: {error}").replace(
          "{error}",
          error.message,
        );
        if (target.requiredInputs?.length) {
          panel.append(button(t("Edit receiver inputs"), () => collect(target, inputs)));
        }
      }
    }
  }
  void search();
  return {
    destroy() {
      active = false;
      sequence += 1;
    },
  };
}
