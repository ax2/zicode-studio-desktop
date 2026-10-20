// Runs in Studio's trusted parent, never in the plugin iframe.
import { t } from "i18n";
import { showTransferInputs, transferInputsPreview } from "./plugin-transfer-inputs.js";
import { toolCategoryTitle } from "./tool-category-title.js";
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
  let currentOffset = 0;
  let view = "all";
  let accessRevision = null;
  let sourceFilter = "";
  let categoryFilter = "";
  let searchController = null;
  const valid = (token) => active && token === sequence && isCurrent();
  const abortSearch = () => { searchController?.abort(); searchController = null; };
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
    abortSearch();
    onCancel();
  };
  const collect = (target, inputs = {}) => {
    if (!active || !isCurrent()) return;
    const token = ++sequence;
    abortSearch();
    showTransferInputs({ panel, target, inputs, onCancel: () => { if (valid(token)) cancel(); },
      onChooseReceiver: () => { if (valid(token)) void search(currentOffset, true); },
      onPreview: (values) => { if (valid(token)) void prepare(target, values); } });
  };

  async function search(offset = 0, focusSearch = false) {
    if (!active || !isCurrent()) return;
    abortSearch();
    const controller = new AbortController(); searchController = controller;
    const token = ++sequence;
    currentOffset = offset;
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
      if (!valid(token)) return;
      query = searchInput.value;
      revision = null;
      accessRevision = null;
      void search();
    };
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
    const views = element("div", null, "ui-toolbar");
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", t("Receiver tool views"));
    for (const [id, label] of [["all", "All"], ["favorites", "Favorites"], ["recent", "Recent"]]) {
      const choice = button(t(label), () => {
        if (!valid(token) || view === id) return;
        view = id;
        query = searchInput.value;
        revision = null;
        accessRevision = null;
        void search();
      });
      choice.setAttribute("aria-pressed", String(view === id));
      choice.classList.toggle("ui-button--primary", view === id);
      views.append(choice);
    }
    const filters = element("div", null, "tool-directory-filters");
    const sourceLabel = element("label", t("Tool source"), "tool-input-field");
    const categoryLabel = element("label", t("Tool category"), "tool-input-field");
    const sourceSelect = element("select", null, "ui-select");
    const categorySelect = element("select", null, "ui-select");
    sourceSelect.setAttribute("aria-label", t("Tool source"));
    categorySelect.setAttribute("aria-label", t("Tool category"));
    sourceSelect.append(new Option(t("All tool sources"), ""));
    categorySelect.append(new Option(t("All tool categories"), ""));
    const changeFilter = () => {
      if (!valid(token)) return;
      sourceFilter = sourceSelect.value;
      categoryFilter = categorySelect.value;
      query = searchInput.value;
      revision = null;
      accessRevision = null;
      void search();
    };
    sourceSelect.addEventListener("change", changeFilter);
    categorySelect.addEventListener("change", changeFilter);
    sourceLabel.append(sourceSelect); categoryLabel.append(categorySelect);
    filters.append(sourceLabel, categoryLabel);
    panel.replaceChildren(
      element("strong", t("Send to tool")),
      element(
        "p",
        t(
          "Choose a receiver and field. Preview does not execute; confirmation starts local computation.",
        ),
      ),
      views,
      filters,
      element("p", t("Filter counts cover all compatible mappings in this view; the result list applies every selected filter.")),
      element("p", t("Favorites and recent use this project's tool history and show only compatible receivers.")),
      searchInput,
      button(t("Search tools"), submit),
      button(t("Cancel transfer"), () => { if (valid(token)) cancel(); }),
      status,
      list,
    );
    if (focusSearch) searchInput.focus();
    try {
      const page = await gateway.searchTargets(
        source.scope,
        source.resultId,
        query,
        offset,
        revision,
        { ...(view !== "all" ? { view, accessRevision } : {}),
          ...(sourceFilter ? { pluginId: sourceFilter } : {}),
          ...(categoryFilter ? { categoryId: categoryFilter } : {}),
          signal: controller.signal },
      );
      if (!valid(token)) return;
      revision = page.revision;
      accessRevision = page.accessRevision ?? null;
      const fillFilter = (select, all, selected, entries, key, label) => {
        select.replaceChildren(new Option(t(all), ""));
        for (const entry of entries ?? []) if (typeof entry?.[key] === "string")
          select.append(new Option(`${label(entry)} · ${entry.count}`, entry[key]));
        if (selected && ![...select.options].some(option => option.value === selected))
          select.append(new Option(selected, selected));
        select.value = selected;
      };
      fillFilter(sourceSelect, "All tool sources", sourceFilter, page.sources, "pluginId", item => item.title);
      fillFilter(categorySelect, "All tool categories", categoryFilter, page.categories, "id", item => toolCategoryTitle(item.id));
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
              if (!valid(token)) return;
              if (target.requiredInputs?.length) {
                collect(target);
              } else void prepare(target);
            },
          ),
        );
      }
      if (offset > 0)
        list.append(button(t("Previous tool page"), () => { if (valid(token)) void search(Math.max(0, offset - 20)); }));
      if (page.nextOffset !== null)
        list.append(button(t("Next tool page"), () => { if (valid(token)) void search(page.nextOffset); }));
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
        status.textContent = error.code === "result_target_revision_changed"
          ? t("The receiver list changed. Search again to refresh it.")
          : t("Could not search receiver tools: {error}").replace(
          "{error}",
          error.message,
        );
    } finally {
      if (searchController === controller) searchController = null;
    }
  }

  async function prepare(target, inputs = {}) {
    if (!active || !isCurrent()) return;
    const token = ++sequence;
    abortSearch();
    const status = element("p", t("Preparing field mapping preview…"));
    status.setAttribute("role", "status");
    panel.replaceChildren(status, button(t("Cancel transfer"), () => { if (valid(token)) cancel(); }));
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
      const chooseReceiver = button(t("Change receiver"), () => {
        if (valid(token)) void search(currentOffset, true);
      });
      const editInputs = target.requiredInputs?.length
        ? button(t("Edit receiver inputs"), () => { if (valid(token)) collect(target, inputs); })
        : null;
      let committing = false;
      let cancellationRequested = false;
      let checking = false;
      const settle = (result) => {
        if (!valid(token)) return;
        if (!result || result.error || result.result?.ok !== true) {
          const code = result?.error?.code ?? result?.result?.error?.code ?? "unknown";
          status.textContent = code === "worker_cancelled"
            ? t("Receiver tool cancelled")
            : t("Receiver tool failed: {error}").replace("{error}", code);
          cancelButton.disabled = false;
          chooseReceiver.disabled = false;
          if (editInputs) editInputs.disabled = false;
          return;
        }
        active = false;
        onResult(result, {
          ...source.scope,
          pluginId: target.pluginId,
          capabilityId: target.capabilityId,
        });
      };
      const checkOutcome = async () => {
        if (!valid(token) || checking || typeof gateway.transferStatus !== "function") return;
        checking = true;
        checkButton.disabled = true;
        status.textContent = t("Checking receiver outcome…");
        try {
          const outcome = await gateway.transferStatus(source.scope, response.grantId);
          if (!valid(token)) return;
          if (outcome.schemaVersion !== 1 || !["ready", "running", "cancellation_requested", "cancelled", "completed"].includes(outcome.status)) {
            throw new Error("result_transfer_status_invalid");
          }
          if (outcome.status === "completed") {
            settle(outcome.response);
          } else if (outcome.status === "cancelled") {
            status.textContent = t("Receiver tool cancelled");
          } else if (outcome.status === "ready") {
            status.textContent = t("No receiver execution is recorded yet. Choose a receiver again if needed.");
          } else {
            status.textContent = outcome.status === "cancellation_requested"
              ? t("Cancellation requested; waiting for the receiver outcome…")
              : t("Receiver tool is still running. Check its outcome again.");
          }
        } catch (error) {
          if (valid(token)) status.textContent = t("Could not check receiver outcome: {error}").replace("{error}", error.message);
        } finally {
          checking = false;
          if (valid(token)) checkButton.disabled = false;
        }
      };
      const checkButton = button(t("Check receiver outcome"), () => { void checkOutcome(); });
      checkButton.hidden = true;
      const confirm = button(t("Confirm transfer and run"), async () => {
        if (!valid(token)) return;
        committing = true;
        confirm.disabled = true;
        cancelButton.disabled = typeof gateway.cancelTransfer !== "function";
        chooseReceiver.disabled = true;
        if (editInputs) editInputs.disabled = true;
        status.textContent = t("Running receiver tool…");
        try {
          const result = await gateway.commitTransfer(source.scope, response.grantId);
          settle(result);
        } catch (error) {
          if (valid(token)) {
            status.textContent = cancellationRequested
              ? t("Transfer outcome is uncertain after cancellation. Do not run it again.")
              : t("Transfer failed: {error}").replace("{error}", error.message);
            confirm.disabled = true;
            cancelButton.disabled = false;
            chooseReceiver.disabled = false;
            if (editInputs) editInputs.disabled = false;
            if (typeof gateway.transferStatus === "function") {
              checkButton.hidden = false;
              void checkOutcome();
            }
          }
        } finally {
          committing = false;
        }
      });
      const cancelButton = button(t("Cancel transfer"), async () => {
        if (!valid(token)) return;
        if (!committing) { cancel(); return; }
        if (cancellationRequested || typeof gateway.cancelTransfer !== "function") return;
        cancelButton.disabled = true;
        status.textContent = t("Requesting receiver cancellation…");
        try {
          const outcome = await gateway.cancelTransfer(source.scope, response.grantId);
          if (!valid(token)) return;
          if (outcome.schemaVersion !== 1 || !["cancelled", "cancellation_requested", "completed"].includes(outcome.status)) {
            throw new Error("result_transfer_cancel_response_invalid");
          }
          cancellationRequested = true;
          status.textContent = outcome.status === "completed"
            ? t("Receiver already completed. Checking its outcome…")
            : t("Cancellation requested; waiting for the receiver outcome…");
          if (typeof gateway.transferStatus === "function") {
            checkButton.hidden = false;
            if (outcome.status === "completed") void checkOutcome();
          }
        } catch (error) {
          if (!valid(token)) return;
          status.textContent = t("Could not request cancellation: {error}").replace("{error}", error.message);
          cancelButton.disabled = false;
        }
      });
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
        ...(preview.mimeType === "application/json" ? [element("p", t("JSON object will be passed to an object input field."))] : []),
        transferInputsPreview(preview.inputs),
        confirm,
        ...[editInputs].filter(Boolean),
        chooseReceiver,
        cancelButton,
        checkButton,
        status,
      );
      confirm.focus();
    } catch (error) {
      if (valid(token)) {
        status.textContent = t("Could not prepare transfer: {error}").replace(
          "{error}",
          error.message,
        );
        panel.append(button(t("Change receiver"), () => {
          if (valid(token)) void search(currentOffset, true);
        }));
        if (target.requiredInputs?.length) {
          panel.append(button(t("Edit receiver inputs"), () => { if (valid(token)) collect(target, inputs); }));
        }
      }
    }
  }
  void search();
  return {
    destroy() {
      active = false;
      sequence += 1;
      abortSearch();
    },
  };
}
