import { t } from "../../i18n.js";
import { renderMarkdown } from "../../ui/markdown.js";

const NOTES_PLUGIN_ID = "com.zicode.notes";

export function setupNotesApp({
  gateway,
  getTarget = () => null,
  notify = () => {},
  confirmDiscard = (message) => globalThis.confirm?.(message) ?? false,
  confirmDelete = (message) => globalThis.confirm?.(message) ?? false,
  confirmPublish = (message) => globalThis.confirm?.(message) ?? false,
  chooseFile = defaultChooseFile,
  downloadFile = defaultDownloadFile,
  onUseInChat = null,
} = {}) {
  if (!gateway) return null;

  let navigation = null;
  let content = null;
  let snapshot = { notebooks: [], notes: [], tags: [] };
  let selectedNotebookId = null;
  let selectedNote = null;
  let loading = false;
  let error = null;
  let mode = "library";
  let dirty = false;
  let preview = false;
  let query = "";
  let selectedTag = null;
  let sourceOnly = false;
  let searchTimer = null;
  const expandedNotebookIds = new Set();

  const sceneId = () => getTarget()?.sceneId ?? "programming";

  function renderNavigation(container) {
    navigation = container;
    drawNavigation();
    if (!loading && snapshot.notebooks.length === 0 && !error) void load();
  }

  function renderContent(container) {
    content = container;
    drawContent();
    if (!loading && snapshot.notebooks.length === 0 && !error) void load();
  }

  async function load({ preserveSelection = true } = {}) {
    loading = true;
    error = null;
    draw();
    try {
      const response = await gateway.list(sceneId(), {
        // Always request the visible library so the function area can render a
        // stable notebook -> note tree. Notebook selection chooses the target
        // for creation/export; it no longer flattens the tree into a second list.
        notebookId: null,
        query,
        tag: selectedTag,
        sourceOnly,
      });
      snapshot = response.snapshot ?? { notebooks: [], notes: [], tags: [] };
      if (
        selectedNotebookId &&
        !snapshot.notebooks.some((notebook) => notebook.id === selectedNotebookId)
      ) {
        selectedNotebookId = null;
      }
      if (
        preserveSelection &&
        selectedNote &&
        snapshot.notes.some((note) => note.id === selectedNote.id)
      ) {
        // Keep the open document and any unsaved editor state.
      } else if (!dirty) {
        selectedNote = null;
      }
    } catch (loadError) {
      error = loadError;
    } finally {
      loading = false;
      draw();
    }
  }

  async function selectNote(summary) {
    if (!canDeactivateEditor()) return;
    loading = true;
    error = null;
    drawContent();
    try {
      const response = await gateway.get(sceneId(), summary.notebookId, summary.id);
      selectedNote = response.note;
      selectedNotebookId = response.note.notebookId;
      expandedNotebookIds.add(response.note.notebookId);
      dirty = false;
      preview = false;
      mode = "library";
    } catch (loadError) {
      error = loadError;
    } finally {
      loading = false;
      draw();
    }
  }

  function canDeactivateEditor() {
    if (!dirty) return true;
    return confirmDiscard(t("Discard unsaved note changes?"));
  }

  async function createNotebook(title) {
    const normalized = title.trim();
    if (!normalized) return;
    loading = true;
    error = null;
    draw();
    try {
      const response = await gateway.createNotebook(sceneId(), normalized);
      selectedNotebookId = response.notebook.id;
      expandedNotebookIds.add(response.notebook.id);
      mode = "library";
      await load({ preserveSelection: false });
    } catch (createError) {
      error = createError;
      loading = false;
      draw();
    }
  }

  async function newNote() {
    if (!canDeactivateEditor()) return;
    const notebookId = selectedNotebookId ?? snapshot.notebooks[0]?.id;
    if (!notebookId) {
      mode = "new-notebook";
      drawContent();
      return;
    }
    loading = true;
    error = null;
    draw();
    try {
      const response = await gateway.create(sceneId(), notebookId, {
        title: t("Untitled note"),
        content: "",
        tags: [],
      });
      selectedNote = response.note;
      selectedNotebookId = notebookId;
      expandedNotebookIds.add(notebookId);
      dirty = false;
      preview = false;
      mode = "library";
      await load();
    } catch (createError) {
      error = createError;
      loading = false;
      draw();
    }
  }

  async function captureChatExchange({ question = "", answer = "", sessionId = "" } = {}) {
    const normalizedAnswer = String(answer).trim();
    if (!normalizedAnswer) throw new Error(t("There is no assistant response to save"));
    if (snapshot.notebooks.length === 0) await load({ preserveSelection: false });
    let notebook =
      snapshot.notebooks.find((candidate) => candidate.title === t("Conversation Notes")) ||
      snapshot.notebooks[0];
    if (!notebook) {
      const created = await gateway.createNotebook(sceneId(), t("Conversation Notes"));
      notebook = created.notebook;
    }
    const normalizedQuestion = String(question).trim();
    const title = conversationNoteTitle(normalizedQuestion || normalizedAnswer);
    const provenance = [
      `> ${t("Captured from Chat")}`,
      sessionId ? `> ${t("Session")}: \`${sessionId}\`` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const body = [
      provenance,
      normalizedQuestion ? `## ${t("Question")}\n\n${normalizedQuestion}` : "",
      `## ${t("Answer")}\n\n${normalizedAnswer}`,
      `---\n${t("Continue this knowledge in Chat with the Discuss in Chat action.")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const response = await gateway.create(sceneId(), notebook.id, {
      title,
      content: body,
      tags: ["chat", "captured"],
    });
    selectedNotebookId = notebook.id;
    expandedNotebookIds.add(notebook.id);
    selectedNote = response.note;
    mode = "library";
    dirty = false;
    preview = true;
    snapshot = {
      ...snapshot,
      notebooks: snapshot.notebooks.some((candidate) => candidate.id === notebook.id)
        ? snapshot.notebooks.map((candidate) =>
            candidate.id === notebook.id
              ? { ...candidate, noteCount: Number(candidate.noteCount || 0) + 1 }
              : candidate,
          )
        : [{ ...notebook, noteCount: 1 }, ...snapshot.notebooks],
      notes: [response.note, ...snapshot.notes.filter((note) => note.id !== response.note.id)],
      tags: [...new Set([...(snapshot.tags || []), "chat", "captured"])],
    };
    notify(t("Conversation saved to Notes"));
    draw();
    return response.note;
  }

  function startCapture() {
    if (!canDeactivateEditor()) return;
    if (!selectedNotebookId && snapshot.notebooks.length === 0) {
      mode = "new-notebook";
    } else {
      selectedNotebookId ??= snapshot.notebooks[0]?.id ?? null;
      mode = "capture";
    }
    drawContent();
  }

  async function saveEditor() {
    if (!selectedNote || !content) return;
    const title = content.querySelector("[data-notes-title]")?.value ?? "";
    const body = content.querySelector("[data-notes-content]")?.value ?? selectedNote.content;
    const tags = parseTags(content.querySelector("[data-notes-tags]")?.value ?? "");
    const save = content.querySelector("[data-notes-save]");
    if (save) save.disabled = true;
    try {
      const response = await gateway.save(sceneId(), {
        ...selectedNote,
        title,
        content: body,
        tags,
      });
      selectedNote = response.note;
      dirty = false;
      notify(t("Note saved"));
      await load();
    } catch (saveError) {
      error = saveError;
      drawContent();
    } finally {
      if (save?.isConnected) save.disabled = false;
    }
  }

  async function deleteSelectedNote() {
    if (!selectedNote) return;
    if (!confirmDelete(`${t("Delete note")} “${selectedNote.title}”?`)) return;
    loading = true;
    draw();
    try {
      await gateway.delete(sceneId(), selectedNote);
      selectedNote = null;
      dirty = false;
      await load({ preserveSelection: false });
      notify(t("Note deleted"));
    } catch (deleteError) {
      error = deleteError;
      loading = false;
      draw();
    }
  }

  async function captureUrl(form) {
    const url = form.elements.url.value.trim();
    const title = form.elements.title.value.trim();
    const notebookId = form.elements.notebookId.value;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    error = null;
    drawError(form.querySelector("[data-notes-form-error]"), null);
    try {
      const response = await gateway.capture(sceneId(), notebookId, {
        url,
        title: title || undefined,
      });
      selectedNotebookId = response.note.notebookId;
      if (response.duplicate) notify(t("This page is already in your notes"));
      await selectNote(response.note);
      await load();
    } catch (captureError) {
      drawError(form.querySelector("[data-notes-form-error]"), captureError);
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  }

  async function attachFile() {
    if (!selectedNote) return;
    try {
      const file = await chooseFile(".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.json");
      if (!file) return;
      if (!file.size || file.size > 5 * 1024 * 1024) {
        throw new Error(t("Attachments must contain 1 byte to 5 MiB"));
      }
      const response = await gateway.uploadAttachment(sceneId(), selectedNote, {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64: await fileToBase64(file),
      });
      if (preview) {
        preview = false;
        drawContent();
      }
      const textarea = content?.querySelector("[data-notes-content]");
      if (!textarea) return;
      const separator = textarea.value && !textarea.value.endsWith("\n") ? "\n\n" : "";
      const insertion = `${separator}${response.attachment.markdown}\n`;
      textarea.setRangeText(
        insertion,
        textarea.selectionStart ?? textarea.value.length,
        textarea.selectionEnd ?? textarea.value.length,
        "end",
      );
      markDirty();
      notify(t("Attachment added"));
    } catch (attachmentError) {
      error = attachmentError;
      drawContent();
    }
  }

  async function importMarkdown() {
    if (!selectedNotebookId) {
      mode = "new-notebook";
      drawContent();
      return;
    }
    try {
      const file = await chooseFile(".md,.markdown");
      if (!file) return;
      if (!file.size || file.size > 1024 * 1024) {
        throw new Error(t("Markdown import exceeds the 1 MiB limit"));
      }
      const response = await gateway.importMarkdown(
        sceneId(),
        selectedNotebookId,
        file.name,
        await file.text(),
      );
      selectedNote = response.note;
      dirty = false;
      preview = false;
      await load();
      notify(t("Markdown imported"));
    } catch (importError) {
      error = importError;
      draw();
    }
  }

  async function exportBackup() {
    const notebook = snapshot.notebooks.find((candidate) => candidate.id === selectedNotebookId);
    if (!notebook) {
      notify(t("Select a notebook first"));
      return;
    }
    try {
      const response = await gateway.exportBackup(sceneId(), notebook.id);
      downloadFile(
        `${safeFileName(notebook.title)}.zicode-notes.json`,
        JSON.stringify(response.backup, null, 2),
        "application/json",
      );
      notify(t("Readable backup exported"));
    } catch (exportError) {
      error = exportError;
      draw();
    }
  }

  async function importBackup() {
    try {
      const file = await chooseFile(".json");
      if (!file) return;
      if (!file.size || file.size > 70 * 1024 * 1024) {
        throw new Error(t("Notes backup exceeds the 70 MiB limit"));
      }
      const backup = JSON.parse(await file.text());
      const response = await gateway.importBackup(sceneId(), backup);
      selectedNotebookId = response.notebook.id;
      selectedNote = null;
      dirty = false;
      await load({ preserveSelection: false });
      notify(t("Notes backup imported"));
    } catch (importError) {
      error =
        importError instanceof SyntaxError
          ? new Error(t("Notes backup is not valid JSON"))
          : importError;
      draw();
    }
  }

  async function rebuildIndex() {
    if (!selectedNotebookId) {
      notify(t("Select a notebook first"));
      return;
    }
    try {
      const response = await gateway.rebuild(sceneId(), selectedNotebookId);
      const report = response.report;
      await load();
      notify(
        `${t("Vault check complete")}: ${report.validNotes} ${t("valid notes")}, ${
          report.invalidFiles.length
        } ${t("invalid files")}`,
      );
    } catch (rebuildError) {
      error = rebuildError;
      draw();
    }
  }

  async function publishAstro() {
    if (!selectedNotebookId) {
      notify(t("Select a notebook first"));
      return;
    }
    const notebook = snapshot.notebooks.find((candidate) => candidate.id === selectedNotebookId);
    if (!notebook) return;
    if (
      !confirmPublish(
        t("Build this notebook as a local Astro site? Dependencies may be downloaded."),
      )
    ) {
      return;
    }
    const invoke = globalThis.__TAURI__?.core?.invoke;
    if (!invoke) {
      error = new Error(t("Astro publishing is available in the desktop application."));
      draw();
      return;
    }
    loading = true;
    error = null;
    draw();
    try {
      const report = await invoke("publish_notes_notebook", { notebookId: notebook.id });
      notify(`${t("Astro site built")}: ${report.noteCount} ${t("notes")} · dist/`);
    } catch (publishError) {
      error = publishError instanceof Error ? publishError : new Error(String(publishError));
    } finally {
      loading = false;
      draw();
    }
  }

  function draw() {
    drawNavigation();
    drawContent();
  }

  function drawNavigation() {
    if (!navigation) return;
    navigation.replaceChildren();
    const actions = element("div", "notes-nav-actions");
    actions.append(
      button(t("New note"), "notes-new-note", () => void newNote(), "ui-button--primary"),
      button(t("Capture URL"), "notes-capture", startCapture, "ui-button--secondary"),
      button(t("New notebook"), "notes-new-notebook", () => {
        mode = "new-notebook";
        drawContent();
      }),
    );
    const search = document.createElement("input");
    search.type = "search";
    search.className = "notes-search-input";
    search.placeholder = t("Search notes");
    search.setAttribute("aria-label", t("Search notes"));
    search.value = query;
    search.addEventListener("input", () => {
      query = search.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void load({ preserveSelection: true }), 180);
    });
    navigation.append(actions, search);

    const notebookSection = navSection(t("Notebooks"), true);
    const allNotebooks = navButton(
      t("All notes"),
      !selectedNotebookId && !sourceOnly && !selectedTag,
      () => {
        selectedNotebookId = null;
        selectedTag = null;
        sourceOnly = false;
        void load();
      },
    );
    notebookSection.body.append(allNotebooks);
    for (const notebook of snapshot.notebooks) {
      notebookSection.body.append(buildNotebookBranch(notebook));
    }
    navigation.append(notebookSection.root);

    const quickSection = navSection(t("Quick access"));
    quickSection.body.append(
      navButton(t("Recent"), false, () => {
        selectedNotebookId = null;
        selectedTag = null;
        sourceOnly = false;
        void load();
      }),
      navButton(t("Web clips"), sourceOnly, () => {
        selectedNotebookId = null;
        selectedTag = null;
        sourceOnly = true;
        void load();
      }),
    );
    navigation.append(quickSection.root);

    if (snapshot.tags.length) {
      const tagSection = navSection(t("Tags"));
      for (const tag of snapshot.tags) {
        tagSection.body.append(
          navButton(`#${tag}`, selectedTag === tag, () => {
            selectedNotebookId = null;
            selectedTag = tag;
            sourceOnly = false;
            void load();
          }),
        );
      }
      navigation.append(tagSection.root);
    }

    const dataSection = navSection(t("Data management"));
    dataSection.body.append(
      navButton(t("Import Markdown"), false, () => void importMarkdown()),
      navButton(t("Export readable backup"), false, () => void exportBackup()),
      navButton(t("Import backup"), false, () => void importBackup()),
      navButton(t("Check and rebuild Vault"), false, () => void rebuildIndex()),
      navButton(t("Build Astro site"), false, () => void publishAstro()),
    );
    navigation.append(dataSection.root);

  }

  function buildNotebookBranch(notebook) {
    const notes = snapshot.notes.filter((note) => note.notebookId === notebook.id);
    const branch = document.createElement("details");
    branch.className = "notes-notebook-branch";
    branch.dataset.notebookId = notebook.id;
    if (expandedNotebookIds.size === 0 && snapshot.notebooks[0]?.id === notebook.id) {
      expandedNotebookIds.add(notebook.id);
    }
    branch.open =
      expandedNotebookIds.has(notebook.id) ||
      selectedNotebookId === notebook.id ||
      notes.some((note) => note.id === selectedNote?.id) ||
      Boolean(query || selectedTag || sourceOnly);
    branch.addEventListener("toggle", () => {
      if (branch.open) expandedNotebookIds.add(notebook.id);
      else expandedNotebookIds.delete(notebook.id);
    });

    const summary = document.createElement("summary");
    summary.className = "notes-notebook-summary";
    summary.classList.toggle(
      "active",
      selectedNotebookId === notebook.id && !sourceOnly && !selectedTag,
    );
    summary.append(
      element("span", "notes-notebook-icon", "▱"),
      element("span", "notes-notebook-title", notebook.title),
      element("small", "", String(notebook.noteCount ?? notes.length)),
    );
    summary.addEventListener("click", () => {
      selectedNotebookId = notebook.id;
      selectedTag = null;
      sourceOnly = false;
      for (const item of navigation?.querySelectorAll(".notes-notebook-summary.active") || []) {
        item.classList.remove("active");
      }
      summary.classList.add("active");
    });

    const children = element("div", "notes-notebook-children");
    if (loading && snapshot.notes.length === 0) {
      children.append(message(t("Loading notes…")));
    } else if (notes.length === 0) {
      children.append(message(t("No notes found")));
    } else {
      for (const note of notes) children.append(buildNoteTreeItem(note));
    }
    branch.append(summary, children);
    return branch;
  }

  function buildNoteTreeItem(note) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "notes-list-item notes-tree-note";
    item.classList.toggle("active", selectedNote?.id === note.id);
    const title = element("strong", "", note.title);
    const metadata = element(
      "span",
      "",
      `${formatDate(note.updatedAt)}${note.source ? ` · ${t("Web clip")}` : ""}`,
    );
    item.append(title, metadata);
    item.addEventListener("click", () => void selectNote(note));
    return item;
  }

  function drawContent() {
    if (!content) return;
    content.replaceChildren();
    content.classList.add("notes-main");
    if (loading && !selectedNote) {
      content.append(stateCard(t("Loading notes…")));
      return;
    }
    if (mode === "new-notebook") {
      content.append(notebookForm());
      return;
    }
    if (mode === "capture") {
      content.append(captureForm());
      return;
    }
    if (selectedNote) {
      content.append(noteEditor());
      return;
    }
    if (error) {
      content.append(errorCard(error, () => void load()));
      return;
    }
    content.append(emptyLibrary());
  }

  function notebookForm() {
    const section = panel(
      t("Create notebook"),
      t("Each notebook is a readable Astro-compatible Markdown vault."),
    );
    const form = document.createElement("form");
    form.className = "notes-form";
    const input = labeledInput(t("Notebook name"), "title", t("My Notes"));
    input.input.required = true;
    const actions = formActions(t("Create notebook"), () => {
      mode = "library";
      drawContent();
    });
    form.append(input.wrapper, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void createNotebook(input.input.value);
    });
    section.append(form);
    queueMicrotask(() => input.input.focus());
    return section;
  }

  function captureForm() {
    const section = panel(
      t("Capture web page"),
      t(
        "ZiCode retrieves readable public content without sending cookies or authorization headers.",
      ),
    );
    const form = document.createElement("form");
    form.className = "notes-form";
    const url = labeledInput(t("Page URL"), "url", "https://example.com/article", "url");
    url.input.required = true;
    const title = labeledInput(t("Title override (optional)"), "title", "");
    const notebook = document.createElement("label");
    notebook.textContent = t("Notebook");
    const select = document.createElement("select");
    select.name = "notebookId";
    for (const candidate of snapshot.notebooks) {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.title;
      option.selected = candidate.id === selectedNotebookId;
      select.append(option);
    }
    notebook.append(select);
    const formError = element("p", "notes-form-error");
    formError.dataset.notesFormError = "";
    form.append(
      url.wrapper,
      title.wrapper,
      notebook,
      formError,
      formActions(t("Capture"), () => {
        mode = "library";
        drawContent();
      }),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void captureUrl(form);
    });
    section.append(form);
    queueMicrotask(() => url.input.focus());
    return section;
  }

  function noteEditor() {
    const wrapper = document.createElement("section");
    wrapper.className = "notes-editor";
    const toolbar = element("div", "notes-editor-toolbar");
    const left = element("div", "notes-editor-tabs");
    left.setAttribute("role", "group");
    left.setAttribute("aria-label", t("Note view"));
    const edit = button(
      t("Edit"),
      "",
      () => {
        preview = false;
        drawContent();
      },
      preview ? "ui-button--ghost" : "ui-button--secondary",
    );
    edit.setAttribute("aria-pressed", String(!preview));
    edit.dataset.notesMode = "edit";
    const previewButton = button(
      t("Preview"),
      "",
      () => {
        syncDraftFromEditor();
        preview = true;
        drawContent();
      },
      preview ? "ui-button--secondary" : "ui-button--ghost",
    );
    previewButton.setAttribute("aria-pressed", String(preview));
    previewButton.dataset.notesMode = "preview";
    left.append(edit, previewButton);
    const right = element("div", "notes-editor-actions");
    right.setAttribute("role", "group");
    right.setAttribute("aria-label", t("Note actions"));
    const save = button(t("Save"), "notes-save", () => void saveEditor(), "ui-button--primary");
    save.dataset.notesSave = "";
    save.disabled = !dirty;
    right.append(
      button(
        t("Discuss in Chat"),
        "notes-use-in-chat",
        () => onUseInChat?.(structuredClone(selectedNote)),
        "ui-button--secondary",
      ),
      button(t("Attach"), "notes-attach", () => void attachFile(), "ui-button--ghost"),
      save,
      button(t("Delete"), "notes-delete", () => void deleteSelectedNote(), "ui-button--danger"),
    );
    toolbar.append(left, right);

    if (error) wrapper.append(errorBanner(error));
    const title = document.createElement("input");
    title.className = "notes-title-input";
    title.value = selectedNote.title;
    title.placeholder = t("Note title");
    title.setAttribute("aria-label", t("Note title"));
    title.dataset.notesTitle = "";
    const tags = document.createElement("input");
    tags.className = "notes-tags-input";
    tags.value = selectedNote.tags.join(", ");
    tags.placeholder = t("Tags separated by commas");
    tags.setAttribute("aria-label", t("Tags separated by commas"));
    tags.dataset.notesTags = "";
    for (const input of [title, tags]) {
      input.addEventListener("input", markDirty);
    }

    wrapper.append(toolbar, title, tags);
    if (selectedNote.source) {
      const source = element("p", "notes-source");
      source.append(`${t("Source")}: `);
      const link = document.createElement("a");
      link.href = selectedNote.source.url;
      link.textContent = selectedNote.source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      source.append(link);
      wrapper.append(source);
    }
    if (preview) {
      const previewElement = element("article", "notes-preview markdown-body");
      previewElement.innerHTML = renderMarkdown(selectedNote.content);
      rewriteAttachmentUrls(previewElement, gateway, sceneId(), selectedNote);
      wrapper.append(previewElement);
    } else {
      const textarea = document.createElement("textarea");
      textarea.className = "notes-content-input";
      textarea.value = selectedNote.content;
      textarea.placeholder = t("Write Markdown…");
      textarea.setAttribute("aria-label", t("Note content"));
      textarea.dataset.notesContent = "";
      textarea.addEventListener("input", markDirty);
      wrapper.append(textarea);
    }
    return wrapper;
  }

  function syncDraftFromEditor() {
    if (!selectedNote || !content) return;
    const title = content.querySelector("[data-notes-title]");
    const tags = content.querySelector("[data-notes-tags]");
    const body = content.querySelector("[data-notes-content]");
    if (title) selectedNote.title = title.value;
    if (tags) selectedNote.tags = parseTags(tags.value);
    if (body) selectedNote.content = body.value;
  }

  function markDirty() {
    dirty = true;
    const save = content?.querySelector("[data-notes-save]");
    if (save) save.disabled = false;
  }

  function emptyLibrary() {
    const section = panel(
      snapshot.notebooks.length ? t("No note selected") : t("Your local Notes library"),
      snapshot.notebooks.length
        ? t("Choose a note from the function area or create a new one.")
        : t("Create a notebook to start a readable Markdown and Astro-compatible vault."),
    );
    const actions = element("div", "notes-empty-actions");
    if (snapshot.notebooks.length) {
      actions.append(
        button(t("New note"), "", () => void newNote(), "ui-button--primary"),
        button(t("Capture URL"), "", startCapture, "ui-button--secondary"),
      );
    } else {
      actions.append(
        button(
          t("Create notebook"),
          "",
          () => {
            mode = "new-notebook";
            drawContent();
          },
          "ui-button--primary",
        ),
      );
    }
    section.append(actions);
    return section;
  }

  function setTarget() {
    if (document.body.dataset.activePlugin === NOTES_PLUGIN_ID) {
      selectedNote = null;
      dirty = false;
      void load({ preserveSelection: false });
    }
  }

  function handleKeydown(event) {
    if (
      document.body.dataset.activePlugin === NOTES_PLUGIN_ID &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      void saveEditor();
    }
  }

  document.addEventListener("keydown", handleKeydown);

  return {
    renderNavigation,
    renderContent,
    setTarget,
    newNote,
    startCapture,
    captureChatExchange,
    canDeactivate: canDeactivateEditor,
    destroy() {
      clearTimeout(searchTimer);
      document.removeEventListener("keydown", handleKeydown);
    },
  };
}

function conversationNoteTitle(value) {
  const line = String(value)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  const cleaned = (line || "Conversation insight")
    .replace(/^#{1,6}\s*/, "")
    .replace(/[*_`>[\]]/g, "")
    .trim();
  return Array.from(cleaned).slice(0, 80).join("") || "Conversation insight";
}

function navSection(title, expanded = false) {
  const root = document.createElement("details");
  root.className = "notes-nav-section";
  root.open = expanded;
  const summary = document.createElement("summary");
  summary.textContent = title;
  const body = element("div", "notes-nav-section-body");
  root.append(summary, body);
  return { root, body };
}

function navButton(label, active, action, count = null) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "notes-nav-item";
  control.classList.toggle("active", active);
  control.setAttribute("aria-pressed", String(active));
  control.append(element("span", "", label));
  if (count !== null) control.append(element("small", "", String(count)));
  control.addEventListener("click", action);
  return control;
}

function button(label, className, action, variant = "ui-button--ghost") {
  const control = document.createElement("button");
  control.type = "button";
  control.className = `ui-button ui-button--sm ${variant} ${className}`.trim();
  control.textContent = label;
  control.addEventListener("click", action);
  return control;
}

function panel(title, description) {
  const section = element("section", "notes-state-panel ui-card");
  section.append(element("h1", "", title), element("p", "", description));
  return section;
}

function stateCard(text) {
  return panel(text, "");
}

function errorCard(error, retry) {
  const section = panel(t("Notes unavailable"), error?.message ?? String(error));
  section.append(button(t("Retry"), "", retry, "ui-button--primary"));
  return section;
}

function errorBanner(error) {
  const banner = element("div", "notes-error-banner");
  banner.setAttribute("role", "alert");
  banner.textContent =
    error?.code === "version_conflict"
      ? t("This note changed elsewhere. Reload it before editing again.")
      : (error?.message ?? String(error));
  return banner;
}

function formActions(primaryLabel, cancel) {
  const actions = element("div", "notes-form-actions");
  const actualSubmit = document.createElement("button");
  actualSubmit.type = "submit";
  actualSubmit.className = "ui-button ui-button--sm ui-button--primary";
  actualSubmit.textContent = primaryLabel;
  const cancelButton = button(t("Cancel"), "", cancel, "ui-button--ghost");
  actions.append(actualSubmit, cancelButton);
  return actions;
}

function labeledInput(label, name, placeholder, type = "text") {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.placeholder = placeholder;
  wrapper.append(input);
  return { wrapper, input };
}

function message(text) {
  return element("p", "notes-nav-message", text);
}

function drawError(container, error) {
  if (!container) return;
  container.textContent = error?.message ?? "";
  container.hidden = !error;
}

function parseTags(value) {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function defaultChooseFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    input.addEventListener(
      "change",
      () => {
        resolve(input.files?.[0] ?? null);
        input.remove();
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
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

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 32 * 1024;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
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
      .slice(0, 100) || "notes"
  );
}

function rewriteAttachmentUrls(container, gateway, activeSceneId, note) {
  const prefix = `/attachments/${note.id}/`;
  for (const target of container.querySelectorAll("[src], [href]")) {
    const attribute = target.hasAttribute("src") ? "src" : "href";
    const value = target.getAttribute(attribute);
    if (!value?.startsWith(prefix)) continue;
    const attachmentId = value.slice(prefix.length);
    if (!/^[0-9a-f-]{36}\.(png|jpg|gif|webp|pdf|txt|md|csv|json)$/.test(attachmentId)) {
      continue;
    }
    target.setAttribute(attribute, gateway.attachmentUrl(activeSceneId, note, attachmentId));
  }
}
