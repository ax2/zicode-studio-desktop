import { t } from "../../i18n.js";
import { renderMarkdown } from "../../ui/markdown.js";

const EMPTY_SNAPSHOT = Object.freeze({ artifacts: [], kinds: [], plugins: [] });

export function setupArtifactApp({
  gateway,
  getTarget = () => null,
  notify = () => {},
  confirmDelete = (message) => globalThis.confirm?.(message) ?? false,
  downloadFile = defaultDownloadFile,
} = {}) {
  if (!gateway) return null;

  let navigation = null;
  let content = null;
  let snapshot = structuredClone(EMPTY_SNAPSHOT);
  let selected = null;
  let loading = false;
  let error = null;
  let loadedSceneId = null;
  let query = "";
  let kind = "";
  let pluginId = "";
  let searchTimer = null;
  let requestSequence = 0;

  const sceneId = () => getTarget()?.sceneId ?? "programming";

  function renderNavigation(container) {
    navigation = container;
    drawNavigation();
    ensureLoaded();
  }

  function renderContent(container) {
    content = container;
    drawContent();
    ensureLoaded();
  }

  function ensureLoaded() {
    if (!loading && loadedSceneId !== sceneId()) void load();
  }

  async function load({ preserveSelection = true } = {}) {
    const requestId = ++requestSequence;
    const activeSceneId = sceneId();
    loading = true;
    error = null;
    draw();
    try {
      const response = await gateway.list(activeSceneId, { query, kind, pluginId });
      if (requestId !== requestSequence || activeSceneId !== sceneId()) return;
      snapshot = response.snapshot ?? structuredClone(EMPTY_SNAPSHOT);
      loadedSceneId = activeSceneId;
      if (
        !preserveSelection ||
        (selected && !snapshot.artifacts.some((artifact) => artifact.id === selected.id))
      ) {
        selected = null;
      }
    } catch (loadError) {
      if (requestId === requestSequence) error = loadError;
    } finally {
      if (requestId === requestSequence) {
        loading = false;
        draw();
      }
    }
  }

  async function selectArtifact(descriptor) {
    const requestId = ++requestSequence;
    loading = true;
    error = null;
    drawContent();
    try {
      const response = await gateway.get(sceneId(), descriptor.id);
      if (requestId !== requestSequence) return;
      selected = response.artifact;
    } catch (loadError) {
      if (requestId === requestSequence) error = loadError;
    } finally {
      if (requestId === requestSequence) {
        loading = false;
        draw();
      }
    }
  }

  async function deleteSelected() {
    if (!selected || !confirmDelete(`${t("Delete artifact")} “${selected.title}”?`)) return;
    loading = true;
    error = null;
    draw();
    try {
      await gateway.delete(sceneId(), selected);
      const deletedTitle = selected.title;
      selected = null;
      loadedSceneId = null;
      await load({ preserveSelection: false });
      notify(`${t("Artifact deleted")}: ${deletedTitle}`);
    } catch (deleteError) {
      error = deleteError;
      loading = false;
      draw();
    }
  }

  function exportSelected() {
    if (!selected) {
      notify(t("Select an artifact to export"));
      return false;
    }
    downloadFile(
      `${safeFileName(selected.title)}.zicode-artifact.json`,
      `${JSON.stringify({ schemaVersion: 1, artifact: selected }, null, 2)}\n`,
      "application/json",
    );
    notify(t("Artifact exported"));
    return true;
  }

  function setTarget() {
    requestSequence += 1;
    loadedSceneId = null;
    selected = null;
    snapshot = structuredClone(EMPTY_SNAPSHOT);
    error = null;
    loading = false;
    draw();
    if (navigation || content) ensureLoaded();
  }

  function draw() {
    drawNavigation();
    drawContent();
  }

  function drawNavigation() {
    if (!navigation) return;
    navigation.replaceChildren();
    navigation.classList.add("artifacts-navigation");

    const search = document.createElement("input");
    search.className = "artifacts-search";
    search.type = "search";
    search.value = query;
    search.placeholder = t("Search artifacts");
    search.addEventListener("input", () => {
      query = search.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        loadedSceneId = null;
        void load({ preserveSelection: false });
      }, 180);
    });
    const searchField = element("label", "artifacts-search-field", "");
    searchField.append(element("span", "artifacts-search-label", t("Search artifacts")), search);
    navigation.append(searchField);

    navigation.append(
      filterSection(
        t("Types"),
        [
          { label: t("All"), value: "", active: !kind },
          ...snapshot.kinds.map((value) => ({
            label: t(kindLabel(value)),
            value,
            active: kind === value,
          })),
        ],
        (value) => {
          kind = value;
          loadedSceneId = null;
          void load({ preserveSelection: false });
        },
      ),
    );

    if (snapshot.plugins.length > 0) {
      navigation.append(
        filterSection(
          t("Source plugins"),
          [
            { label: t("All"), value: "", active: !pluginId },
            ...snapshot.plugins.map((value) => ({
              label: pluginLabel(value),
              value,
              active: pluginId === value,
            })),
          ],
          (value) => {
            pluginId = value;
            loadedSceneId = null;
            void load({ preserveSelection: false });
          },
        ),
      );
    }

    const recent = document.createElement("section");
    recent.className = "artifacts-nav-section";
    const heading = document.createElement("h2");
    heading.textContent = t("Recent");
    recent.append(heading);
    if (loading && snapshot.artifacts.length === 0) {
      recent.append(message(t("Loading artifacts…")));
    } else if (snapshot.artifacts.length === 0) {
      recent.append(message(t("No artifacts found")));
    } else {
      for (const artifact of snapshot.artifacts) {
        const item = button("", "artifacts-list-item");
        item.classList.toggle("active", selected?.id === artifact.id);
        item.setAttribute("aria-pressed", String(selected?.id === artifact.id));
        const title = element("strong", "", artifact.title);
        const meta = element(
          "span",
          "",
          `${t(kindLabel(artifact.kind))} · ${formatDate(artifact.createdAt)}`,
        );
        item.append(title, meta);
        item.addEventListener("click", () => void selectArtifact(artifact));
        recent.append(item);
      }
    }
    navigation.append(recent);
  }

  function drawContent() {
    if (!content) return;
    content.replaceChildren();
    content.classList.add("artifacts-main");
    if (error) {
      const panel = statePanel(t("Could not load artifacts"), error.message);
      panel.append(button(t("Retry"), () => void load(), "ui-button ui-button--primary"));
      content.append(panel);
      return;
    }
    if (loading && !selected) {
      content.append(statePanel(t("Loading artifacts…"), ""));
      return;
    }
    if (!selected) {
      content.append(
        statePanel(
          t("Artifacts"),
          t("Reports, datasets, and files created by plugins appear here with their provenance."),
        ),
      );
      return;
    }

    const article = document.createElement("article");
    article.className = "artifacts-document";
    const header = document.createElement("header");
    header.className = "artifacts-document-header";
    const headingGroup = document.createElement("div");
    const kicker = element(
      "span",
      "artifacts-document-kicker",
      `${t(kindLabel(selected.kind))} · ${pluginLabel(selected.pluginId)}`,
    );
    const title = element("h1", "", selected.title);
    headingGroup.append(kicker, title);
    if (selected.summary) headingGroup.append(element("p", "", selected.summary));
    const actions = document.createElement("div");
    actions.className = "artifacts-document-actions";
    actions.append(
      button(t("Export"), exportSelected, "ui-button ui-button--secondary"),
      button(t("Delete"), () => void deleteSelected(), "ui-button ui-button--danger"),
    );
    header.append(headingGroup, actions);

    const metadata = document.createElement("dl");
    metadata.className = "artifacts-metadata";
    appendMetadata(metadata, t("Created"), formatDateTime(selected.createdAt));
    appendMetadata(metadata, t("Format"), selected.mimeType);
    appendMetadata(metadata, t("Size"), formatBytes(selected.size));
    appendMetadata(metadata, t("Resource handle"), selected.handle);

    const body = document.createElement("section");
    body.className = "artifacts-content";
    body.append(element("h2", "", t("Content")));
    const markdown = markdownContent(selected);
    if (markdown !== null) {
      const rendered = element("div", "artifacts-markdown markdown-body");
      rendered.innerHTML = renderMarkdown(markdown);
      body.append(rendered);
    } else {
      body.append(element("pre", "artifacts-json", stringifyContent(selected.content)));
    }

    const provenance = document.createElement("section");
    provenance.className = "artifacts-provenance";
    provenance.append(
      element("h2", "", t("Provenance")),
      element("pre", "artifacts-json", stringifyContent(selected.provenance)),
    );
    article.append(header, metadata, body, provenance);
    content.append(article);
  }

  return {
    deleteSelected,
    exportSelected,
    load,
    renderContent,
    renderNavigation,
    selectArtifact,
    setTarget,
    destroy() {
      clearTimeout(searchTimer);
      requestSequence += 1;
      navigation = null;
      content = null;
    },
  };
}

function filterSection(title, options, onSelect) {
  const section = document.createElement("section");
  section.className = "artifacts-nav-section";
  section.append(element("h2", "", title));
  for (const option of options) {
    const control = button(option.label, () => onSelect(option.value), "artifacts-filter");
    control.classList.toggle("active", option.active);
    control.setAttribute("aria-pressed", String(option.active));
    section.append(control);
  }
  return section;
}

function statePanel(title, description) {
  const panel = element("section", "artifacts-state-panel");
  panel.append(element("h1", "", title));
  if (description) panel.append(element("p", "", description));
  return panel;
}

function appendMetadata(list, label, value) {
  list.append(element("dt", "", label), element("dd", "", value));
}

function markdownContent(artifact) {
  if (artifact.mimeType !== "text/markdown") return null;
  if (typeof artifact.content === "string") return artifact.content;
  if (typeof artifact.content?.markdown === "string") return artifact.content.markdown;
  return null;
}

function stringifyContent(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2);
}

function pluginLabel(value) {
  return (
    {
      "com.zicode.finance": t("Finance"),
      "com.zicode.notes": t("Notes"),
      "com.zicode.artifacts": t("Artifacts"),
    }[value] ?? value
  );
}

function kindLabel(value) {
  return (
    {
      report: "Reports",
      chart: "Charts",
      dataset: "Datasets",
      file: "Files",
    }[value] ?? value
  );
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`;
}

function message(text) {
  return element("p", "artifacts-nav-message", text);
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label, action, className) {
  if (typeof action === "string" && className === undefined) {
    className = action;
    action = null;
  }
  const control = element("button", className, label);
  control.type = "button";
  if (typeof action === "function") control.addEventListener("click", action);
  return control;
}

function safeFileName(value) {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .split("")
      .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
      .join("")
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "artifact"
  );
}

function defaultDownloadFile(fileName, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
