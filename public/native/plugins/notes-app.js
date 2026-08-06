import { t } from "../../i18n.js";
import { renderMarkdown } from "../../ui/markdown.js";

const NOTES_PLUGIN_ID = "com.zicode.notes";
const DEFAULT_NOTEBOOK_ICON = "📓";
const DEFAULT_NOTE_ICON = "📝";
const BUILTIN_TAGS = [
  ["inbox", "📥"],
  ["idea", "💡"],
  ["todo", "✅"],
  ["important", "⭐"],
  ["chat", "💬"],
  ["captured", "🌐"],
  ["web-clip", "🌐"],
  ["project", "🚀"],
  ["question", "❓"],
  ["reference", "📚"],
  ["meeting", "🗓️"],
  ["reading", "📖"],
];
const TAG_ICON_FALLBACK = "🏷️";
const TAG_ICONS = new Map(BUILTIN_TAGS);
const AUTOSAVE_DELAY_MS = 2500;

const EMOJI_GROUPS = [
  [
    "表情",
    ["😀","😁","😂","🤣","😊","😇","🙂","😉","😍","🥰","😘","😜","🤪","😎","🤓","🥳","😏","😒","😞","😔","😢","😭","😤","😡","🤯","😳","🥺","😱","🤔","🤗","🤫","🤭","😴","🤤","😷","🤒","🤕","🤑","🤠","👻","💀","👽","🤖","🎃"],
  ],
  [
    "手势",
    ["👍","👎","👌","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐️","🖖","👋","🤝","💪","👏","🙌","👐","🤲","🙏","💅","🤳"],
  ],
  [
    "动物",
    ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐴","🦄","🐝","🦋","🐌","🐞","🐜","🐢","🐍","🦎","🐙","🦑","🦀","🐳","🐬","🐟","🐠","🦈","🐊"],
  ],
  [
    "食物",
    ["🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🥑","🥦","🥬","🥒","🌽","🥕","🥔","🍠","🥐","🥯","🍞","🥖","🧀","🥚","🍳","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🥪","🌮","🌯","🍜","🍝","🍣","🍤","🍚","🍙","🍦","🍨","🍰","🎂","🍫","🍬","🍭","🍿","☕","🍵","🧃","🥤","🍺","🍻","🥂","🍷"],
  ],
  [
    "活动",
    ["⚽","🏀","🏈","⚾","🎾","🏐","🏓","🏸","⛳","🏹","🎣","🥊","🥋","🎽","⛸️","🥌","🛷","🎿","🏂","🏋️","🤸","🤺","🏇","🧘","🏄","🏊","🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎫","🎭","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🎻","🎲","🎯","🎳","🎮","🎰","🧩"],
  ],
  [
    "旅行",
    ["🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🚚","🚛","🚜","🛵","🏍️","🚲","🛴","🚨","🚡","🚠","🚟","🚃","🚋","🚞","🚝","🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈️","🛫","🛬","🛩️","💺","🛰️","🚀","🛸","🚁","🛶","⛵","🚤","🛥️","🛳️","⛴️","🚢","⚓","🗺️","🗿","🗼","🏰","🏯","🏟️","🎡","🎢","🎠","⛲","⛱️","🏖️","🏝️","🏜️","🌋","⛰️","🏔️","🗻","🏕️","🏠","🏡","🏘️","🏭","🏢","🏬","🏥","🏦","🏨","🏪","🏫","🏩","💒","🏛️","⛪","🕌","🕍","🛕"],
  ],
  [
    "物品",
    ["⌚","📱","💻","⌨️","🖥️","🖨️","🖱️","📷","📸","📹","🎥","📞","☎️","📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭","⏱️","⏲️","⏰","🕰️","⌛","⏳","📡","🔋","🔌","💡","🔦","🕯️","💸","💵","💴","💶","💷","💰","💳","💎","⚖️","🧰","🔧","🔨","⚒️","🛠️","⛏️","🔩","⚙️","🧱","⛓️","🧲","🔪","🗡️","⚔️","🛡️","🔮","🔭","🔬","💊","💉","🩹","🩺","🌡️","🧻","🧹","🧺","🧽","🧼","🛁","🛏️","🛋️","🪑","🚪","🧳","🛒","🎁","🎈","🎏","🎀","🎊","🎉","🎎","🏮","🎐","🧧","✉️","📩","📨","📧","💌","📥","📤","📦","🏷️","📜","📃","📄","📑","🧾","📊","📈","📉","🗒️","🗓️","📆","📅","🗑️","📇","🗃️","🗳️","📁","📂","🗂️","📰","📓","📔","📒","📕","📗","📘","📙","📚","📖","🔖","🔗","📎","📏","📌","📍","✂️","🖊️","🖋️","✒️","🖌️","🖍️","📝","✏️","🔍","🔎","🔏","🔐","🔒","🔓"],
  ],
  [
    "符号",
    ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","💕","💞","💓","💗","💖","💘","💝","🔴","🟠","🟡","🟢","🔵","🟣","🟤","⚫","⚪","🟥","🟧","🟨","🟩","🟦","🟪","🟫","⬛","⬜","🔺","🔻","🔸","🔹","🔶","🔷","♦️","♠️","♣️","♥️","☮️","☯️","✡️","☸️","🕉️","☪️","✝️","☦️","🛐","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","⛎","✅","❎","⭕","❌","❗","❓","💯","💢","💬","💭","💤","⭐","🌟","✨","⚡","🔥","💧","☀️","🌈","☁️","⛈️","🌧️","❄️","⛄","🌙","🌍","🌎","🌏","🌊","🌌","🪐","💠","🌐","🎵","🎶","🔔","🔕","📢","📣","🛑","🚫","♻️","🆗","🆕","🆙","🆒","🔝","🔚","🔙","🔛","🔜","🕐","🕑","🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛"],
  ],
];

const ICONS = {
  edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 2.5l2 2-7 7-2.8.8.8-2.8 7-7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  preview:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  chat: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h10a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H8l-3.5 2.5V11H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  attach:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 4.5v6a1.75 1.75 0 0 0 3.5 0v-6.5a3 3 0 0 0-6 0v7a4.2 4.2 0 0 0 8.4 0V5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  save: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h8l2.5 2.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 13V9h5v4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  trash:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4.5 4.5l.7 8.2a1 1 0 0 0 1 .8h3.6a1 1 0 0 0 1-.8l.7-8.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  globe:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 8h11M8 2.5c1.8 1.6 2.7 3.4 2.7 5.5S9.8 11.9 8 13.5C6.2 11.9 5.3 10.1 5.3 8S6.2 4.1 8 2.5z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  pencil:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.8l2.4 2.4-6.6 6.6-3 .6.6-3 6.6-6.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  close:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

function tagIcon(name) {
  return TAG_ICONS.get(String(name).trim().toLowerCase()) ?? TAG_ICON_FALLBACK;
}

function builtinTagNames() {
  return BUILTIN_TAGS.map(([name]) => name);
}

function allTagSuggestions(existingTags) {
  return [...new Set([...(existingTags || []), ...builtinTagNames()])];
}

export function setupNotesApp({
  gateway,
  getTarget = () => null,
  notify = () => {},
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
  let focusTitleOnNextRender = false;
  let autosaveTimer = null;
  const expandedNotebookIds = new Set();
  const expandedNavSections = new Set();
  let editingNotebookId = null;
  let movePopoverCleanup = null;

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

  async function applyFilter({ tag = null, sourceOnly: clipOnly = false } = {}) {
    if (!(await canDeactivateEditor())) return;
    selectedNotebookId = null;
    selectedTag = tag;
    sourceOnly = clipOnly;
    selectedNote = null;
    dirty = false;
    editingNotebookId = null;
    await load({ preserveSelection: false });
  }

  async function selectNote(summary) {
    if (!(await canDeactivateEditor())) return;
    loading = true;
    error = null;
    drawContent();
    try {
      const response = await gateway.get(sceneId(), summary.notebookId, summary.id);
      selectedNote = response.note;
      selectedNotebookId = response.note.notebookId;
      expandedNotebookIds.add(response.note.notebookId);
      dirty = false;
      preview = true;
      mode = "library";
    } catch (loadError) {
      error = loadError;
    } finally {
      loading = false;
      draw();
    }
  }

  async function canDeactivateEditor() {
    if (!dirty || !selectedNote || !content) return true;
    await saveEditor();
    return true;
  }

  async function createNotebook(title, icon, parentId = null) {
    const normalized = title.trim();
    if (!normalized) return;
    loading = true;
    error = null;
    draw();
    try {
      const response = await gateway.createNotebook(sceneId(), {
        title: normalized,
        icon: icon?.trim() || DEFAULT_NOTEBOOK_ICON,
        parentId,
      });
      selectedNotebookId = response.notebook.id;
      expandedNotebookIds.add(response.notebook.id);
      if (parentId) expandedNotebookIds.add(parentId);
      mode = "library";
      await load({ preserveSelection: false });
    } catch (createError) {
      error = createError;
      loading = false;
      draw();
    }
  }

  async function newNote() {
    if (!(await canDeactivateEditor())) return;
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
        icon: DEFAULT_NOTE_ICON,
      });
      selectedNote = response.note;
      selectedNotebookId = notebookId;
      expandedNotebookIds.add(notebookId);
      dirty = false;
      preview = false;
      focusTitleOnNextRender = true;
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
      const created = await gateway.createNotebook(sceneId(), {
        title: t("Conversation Notes"),
      });
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

  async function startCapture() {
    if (!(await canDeactivateEditor())) return;
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
    clearTimeout(autosaveTimer);
    const title = content.querySelector("[data-notes-title]")?.value ?? "";
    const icon = content.querySelector("[data-notes-icon]")?.value ?? "";
    const body = content.querySelector("[data-notes-content]")?.value ?? selectedNote.content;
    const tags = parseTags(content.querySelector("[data-notes-tags]")?.value ?? "");
    const save = content.querySelector("[data-notes-save]");
    if (save) save.disabled = true;
    try {
      const response = await gateway.save(sceneId(), {
        ...selectedNote,
        title,
        icon: icon.trim() || DEFAULT_NOTE_ICON,
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
    const tags = parseTags(form.querySelector("[data-notes-tags]")?.value ?? "");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    error = null;
    drawError(form.querySelector("[data-notes-form-error]"), null);
    try {
      const response = await gateway.capture(sceneId(), notebookId, {
        url,
        title: title || undefined,
        tags,
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
      void saveEditor();
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
      preview = true;
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
      button(t("New notebook"), "notes-new-notebook", () => {
        mode = "new-notebook";
        drawContent();
      }, "ui-button--secondary"),
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
    navigation.append(search, actions);

    const notebookSection = makeNavSection(t("Notebooks"), true);
    const allNotebooks = navButton(
      t("All notes"),
      !selectedNotebookId && !sourceOnly && !selectedTag,
      () => void applyFilter({}),
    );
    notebookSection.body.append(allNotebooks);
    const childrenByParent = new Map();
    for (const notebook of snapshot.notebooks) {
      const key = notebook.parentId ?? null;
      const siblings = childrenByParent.get(key) ?? [];
      siblings.push(notebook);
      childrenByParent.set(key, siblings);
    }
    for (const notebook of childrenByParent.get(null) ?? []) {
      notebookSection.body.append(buildNotebookBranch(notebook, childrenByParent));
    }
    navigation.append(notebookSection.root);

    const quickSection = makeNavSection(t("Quick access"));
    quickSection.body.append(
      navButton(t("Web clips"), sourceOnly, () => void applyFilter({ sourceOnly: true })),
    );
    navigation.append(quickSection.root);

    if (snapshot.tags.length) {
      const tagSection = makeNavSection(t("Tags"), false, Boolean(selectedTag));
      for (const tag of snapshot.tags) {
        tagSection.body.append(
          navButton(tag, selectedTag === tag, () => void applyFilter({ tag }), null, tagIcon(tag)),
        );
      }
      navigation.append(tagSection.root);
    }

    const dataSection = makeNavSection(t("Data management"));
    dataSection.body.append(
      navButton(t("Import Markdown"), false, () => void importMarkdown()),
      navButton(t("Export readable backup"), false, () => void exportBackup()),
      navButton(t("Import backup"), false, () => void importBackup()),
      navButton(t("Check and rebuild Vault"), false, () => void rebuildIndex()),
      navButton(t("Build Astro site"), false, () => void publishAstro()),
    );
    navigation.append(dataSection.root);

  }

  function makeNavSection(title, defaultExpanded = false, forceExpanded = false) {
    const section = navSection(
      title,
      forceExpanded || defaultExpanded || expandedNavSections.has(title),
    );
    section.root.querySelector("summary")?.addEventListener("toggle", () => {
      if (section.root.open) expandedNavSections.add(title);
      else expandedNavSections.delete(title);
    });
    return section;
  }

  function buildNotebookBranch(notebook, childrenByParent) {
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
      folderGlyph.textContent = branch.open ? "📂" : "📁";
    });

    const folderGlyph = element("span", "notes-folder-glyph", branch.open ? "📂" : "📁");
    const iconBadge = notebook.icon
      ? element("span", "notes-notebook-icon-badge", notebook.icon)
      : null;
    const folderIcon = element("span", "notes-notebook-icon");
    folderIcon.append(folderGlyph);
    if (iconBadge) folderIcon.append(iconBadge);
    const summary = document.createElement("summary");
    summary.className = "notes-notebook-summary";
    summary.classList.toggle(
      "active",
      selectedNotebookId === notebook.id && !sourceOnly && !selectedTag,
    );
    summary.append(
      folderIcon,
      element("span", "notes-notebook-title", notebook.title),
      element("small", "", String(notebook.noteCount ?? notes.length)),
      buildNotebookActions(notebook),
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
    summary.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      summary.classList.add("drag-over");
    });
    summary.addEventListener("dragleave", () => {
      summary.classList.remove("drag-over");
    });
    summary.addEventListener("drop", (event) => {
      event.preventDefault();
      summary.classList.remove("drag-over");
      let payload = null;
      try {
        payload = JSON.parse(event.dataTransfer.getData("text/plain") || "{}");
      } catch {
        payload = null;
      }
      if (
        payload?.noteId &&
        payload?.notebookId &&
        payload.notebookId !== notebook.id
      ) {
        void moveNoteTo(payload.notebookId, payload.noteId, notebook.id);
      }
    });

    const children = element("div", "notes-notebook-children");
    if (loading && snapshot.notes.length === 0) {
      children.append(message(t("Loading notes…")));
    } else if (notes.length === 0) {
      children.append(message(t("No notes found")));
    } else {
      for (const note of notes) children.append(buildNoteTreeItem(note));
    }
    for (const child of childrenByParent.get(notebook.id) ?? []) {
      children.append(buildNotebookBranch(child, childrenByParent));
    }
    branch.append(summary);
    if (editingNotebookId === notebook.id) {
      branch.append(notebookEditForm(notebook));
    }
    branch.append(children);
    return branch;
  }

  function buildNotebookActions(notebook) {
    const actions = element("span", "notes-notebook-actions");
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", t("Notebook actions"));
    actions.append(
      iconActionButton(t("New note in this notebook"), ICONS.plus, "notes-notebook-new-note", () => {
        selectedNotebookId = notebook.id;
        void newNote();
      }),
      iconActionButton(
        t("Capture URL into this notebook"),
        ICONS.globe,
        "notes-notebook-capture",
        () => {
          selectedNotebookId = notebook.id;
          startCapture();
        },
      ),
      iconActionButton(t("Edit notebook"), ICONS.pencil, "notes-notebook-edit", () => {
        editingNotebookId = editingNotebookId === notebook.id ? null : notebook.id;
        drawNavigation();
      }),
    );
    return actions;
  }

  function iconActionButton(label, iconMarkup, className, action) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = `notes-icon-action ${className}`.trim();
    control.title = label;
    control.setAttribute("aria-label", label);
    control.innerHTML = iconMarkup;
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    return control;
  }

  function notebookEditForm(notebook) {
    const form = element("form", "notes-notebook-edit-form");
    const icon = labeledInput(t("Icon"), "icon", DEFAULT_NOTEBOOK_ICON);
    icon.input.value = notebook.icon || DEFAULT_NOTEBOOK_ICON;
    icon.input.maxLength = 8;
    icon.input.title = t("Choose an icon");
    const iconPicker = buildEmojiPicker({
      onPick: (emoji) => {
        icon.input.value = emoji;
        icon.input.focus();
      },
    });
    icon.input.addEventListener("click", () => {
      iconPicker.hidden = false;
    });
    icon.input.addEventListener("focus", () => {
      iconPicker.hidden = false;
    });
    const iconBox = element("div", "notes-icon-box");
    iconBox.append(icon.input, iconPicker);
    icon.wrapper.append(iconBox);
    const title = labeledInput(t("Notebook name"), "title", notebook.title);
    title.input.value = notebook.title;
    title.input.required = true;
    const actions = formActions(t("Save notebook"), () => {
      editingNotebookId = null;
      drawNavigation();
    });
    form.append(icon.wrapper, title.wrapper, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void updateNotebook(notebook.id, title.input.value, icon.input.value);
    });
    queueMicrotask(() => icon.input.focus());
    return form;
  }

  async function updateNotebook(notebookId, title, icon) {
    const normalizedTitle = String(title).trim();
    if (!normalizedTitle) return;
    loading = true;
    error = null;
    draw();
    try {
      await gateway.updateNotebook(sceneId(), {
        notebookId,
        title: normalizedTitle,
        icon: String(icon).trim() || DEFAULT_NOTEBOOK_ICON,
      });
      editingNotebookId = null;
      await load({ preserveSelection: true });
      notify(t("Notebook saved"));
    } catch (updateError) {
      error = updateError;
      loading = false;
      draw();
    }
  }

  function buildNoteTreeItem(note) {
    const item = document.createElement("div");
    item.role = "button";
    item.tabIndex = 0;
    item.className = "notes-list-item notes-tree-note";
    item.classList.toggle("active", selectedNote?.id === note.id);
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData(
        "text/plain",
        JSON.stringify({ noteId: note.id, notebookId: note.notebookId }),
      );
      event.dataTransfer.effectAllowed = "move";
    });
    const title = element("strong", "", note.title);
    const metadata = element(
      "span",
      "",
      `${formatDate(note.updatedAt)}${note.source ? ` · ${t("Web clip")}` : ""}`,
    );
    const main = element("span", "notes-list-item-main");
    main.append(title, metadata);
    if (note.icon) item.append(element("span", "notes-note-icon", note.icon));
    item.append(main);
    const handle = element("span", "notes-drag-handle", "⠿");
    handle.setAttribute("aria-hidden", "true");
    item.append(handle);
    const moveButton = document.createElement("button");
    moveButton.type = "button";
    moveButton.className = "notes-move-btn";
    moveButton.title = t("Move to notebook");
    moveButton.setAttribute("aria-label", t("Move to notebook"));
    moveButton.textContent = "⇄";
    moveButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openMovePopover(moveButton, note);
    });
    item.append(moveButton);
    item.addEventListener("click", () => void selectNote(note));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void selectNote(note);
      }
    });
    return item;
  }

  function openMovePopover(anchor, note) {
    closeMovePopover();
    const popover = element("div", "notes-move-popover");
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", t("Move to notebook"));
    popover.append(
      element("strong", "notes-move-popover-title", `${t("Move to notebook")} · ${note.title}`),
    );
    const list = element("div", "notes-move-popover-list");
    for (const notebook of snapshot.notebooks) {
      if (notebook.id === note.notebookId) continue;
      const option = document.createElement("button");
      option.type = "button";
      option.className = "notes-move-popover-item";
      option.append(
        element("span", "notes-nav-item-icon", notebook.icon || DEFAULT_NOTEBOOK_ICON),
      );
      option.append(element("span", "notes-nav-item-label", notebook.title));
      option.addEventListener("click", () => {
        closeMovePopover();
        void moveNoteTo(note.notebookId, note.id, notebook.id);
      });
      list.append(option);
    }
    if (!list.children.length) list.append(message(t("No other notebooks")));
    popover.append(list);
    document.body.append(popover);
    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${Math.round(rect.bottom + 4)}px`;
    popover.style.left = `${Math.max(8, Math.round(rect.left))}px`;
    const onPointerDown = (event) => {
      if (!popover.contains(event.target) && !anchor.contains(event.target)) closeMovePopover();
    };
    document.addEventListener("pointerdown", onPointerDown);
    movePopoverCleanup = () => {
      document.removeEventListener("pointerdown", onPointerDown);
      popover.remove();
      movePopoverCleanup = null;
    };
  }

  function closeMovePopover() {
    if (movePopoverCleanup) movePopoverCleanup();
  }

  async function moveNoteTo(sourceNotebookId, noteId, targetNotebookId) {
    if (!(await canDeactivateEditor())) return;
    const summary = snapshot.notes.find(
      (candidate) => candidate.id === noteId && candidate.notebookId === sourceNotebookId,
    );
    if (!summary) return;
    loading = true;
    error = null;
    draw();
    try {
      await gateway.moveNote(sceneId(), {
        notebookId: sourceNotebookId,
        noteId,
        targetNotebookId,
        expectedVersion: summary.version,
      });
      if (selectedNote?.id === noteId) {
        selectedNote = null;
        dirty = false;
      }
      await load({ preserveSelection: false });
      notify(t("Note moved"));
    } catch (moveError) {
      error = moveError;
      loading = false;
      draw();
    }
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
    if (selectedTag || sourceOnly) {
      if (snapshot.notes.length > 0) {
        content.append(filterResultsView());
        return;
      }
    }
    if (error) {
      content.append(errorCard(error, () => void load()));
      return;
    }
    content.append(emptyLibrary());
  }

  function filterResultsView() {
    const section = element("section", "notes-results");
    const heading = element(
      "h1",
      "notes-results-title",
      selectedTag ? `${t("Tag")} #${selectedTag}` : t("Web clips"),
    );
    const meta = element("div", "notes-results-meta");
    meta.append(element("span", "", `${snapshot.notes.length} ${t("notes")}`));
    meta.append(
      button(t("Show all notes"), "", () => void applyFilter({}), "ui-button--ghost"),
    );
    const list = element("div", "notes-results-list");
    for (const note of snapshot.notes) {
      const item = document.createElement("div");
      item.role = "button";
      item.tabIndex = 0;
      item.className = "notes-result-item";
      item.draggable = true;
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ noteId: note.id, notebookId: note.notebookId }),
        );
        event.dataTransfer.effectAllowed = "move";
      });
      if (note.icon) item.append(element("span", "notes-result-icon", note.icon));
      const main = element("span", "notes-result-main");
      main.append(element("strong", "", note.title));
      main.append(element("span", "", formatDate(note.updatedAt)));
      item.append(main);
      const moveButton = document.createElement("button");
      moveButton.type = "button";
      moveButton.className = "notes-move-btn";
      moveButton.title = t("Move to notebook");
      moveButton.setAttribute("aria-label", t("Move to notebook"));
      moveButton.textContent = "⇄";
      moveButton.addEventListener("click", (event) => {
        event.stopPropagation();
        openMovePopover(moveButton, note);
      });
      item.append(moveButton);
      item.addEventListener("click", () => void selectNote(note));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void selectNote(note);
        }
      });
      list.append(item);
    }
    section.append(heading, meta, list);
    return section;
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
    const icon = labeledInput(t("Icon"), "icon", DEFAULT_NOTEBOOK_ICON);
    icon.input.maxLength = 8;
    icon.input.title = t("Choose an icon");
    const iconPicker = buildEmojiPicker({
      onPick: (emoji) => {
        icon.input.value = emoji;
        icon.input.focus();
      },
    });
    icon.input.addEventListener("click", () => {
      iconPicker.hidden = false;
    });
    icon.input.addEventListener("focus", () => {
      iconPicker.hidden = false;
    });
    const iconBox = element("div", "notes-icon-box");
    iconBox.append(icon.input, iconPicker);
    icon.wrapper.append(iconBox);
    const parent = document.createElement("label");
    parent.textContent = t("Parent notebook");
    const parentSelect = document.createElement("select");
    parentSelect.name = "parentId";
    const topLevel = document.createElement("option");
    topLevel.value = "";
    topLevel.textContent = t("Top level");
    parentSelect.append(topLevel);
    for (const candidate of snapshot.notebooks) {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.title;
      option.selected = candidate.id === selectedNotebookId;
      parentSelect.append(option);
    }
    parent.append(parentSelect);
    const actions = formActions(t("Create notebook"), () => {
      mode = "library";
      drawContent();
    });
    form.append(input.wrapper, icon.wrapper, parent, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void createNotebook(input.input.value, icon.input.value, parentSelect.value || null);
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
    const tags = buildTagEditor([]);
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
      tags,
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
    const edit = toolbarButton(
      t("Edit"),
      ICONS.edit,
      "notes-edit-tab",
      () => {
        syncDraftFromEditor();
        preview = false;
        drawContent();
      },
      preview ? "ui-button--ghost" : "ui-button--secondary",
    );
    edit.setAttribute("aria-pressed", String(!preview));
    edit.dataset.notesMode = "edit";
    const previewButton = toolbarButton(
      t("Preview"),
      ICONS.preview,
      "notes-preview-tab",
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
    const save = toolbarButton(
      t("Save"),
      ICONS.save,
      "notes-save",
      () => void saveEditor(),
      "ui-button--primary",
    );
    save.dataset.notesSave = "";
    save.disabled = !dirty;
    let deleteArmed = false;
    let deleteArmTimer = null;
    const del = toolbarButton(
      t("Delete"),
      ICONS.trash,
      "notes-delete",
      () => {
        if (!deleteArmed) {
          deleteArmed = true;
          del.classList.add("notes-delete-armed");
          const label = del.querySelector(".notes-btn-label");
          if (label) label.textContent = t("Confirm delete");
          del.setAttribute("aria-label", t("Confirm delete"));
          clearTimeout(deleteArmTimer);
          deleteArmTimer = setTimeout(resetDelete, 3000);
          return;
        }
        resetDelete();
        void deleteSelectedNote();
      },
      "ui-button--danger",
    );
    function resetDelete() {
      deleteArmed = false;
      clearTimeout(deleteArmTimer);
      del.classList.remove("notes-delete-armed");
      const label = del.querySelector(".notes-btn-label");
      if (label) label.textContent = t("Delete");
      del.setAttribute("aria-label", t("Delete"));
    }
    right.append(
      toolbarButton(
        t("Discuss in Chat"),
        ICONS.chat,
        "notes-use-in-chat",
        () => onUseInChat?.(structuredClone(selectedNote), currentSelection()),
        "ui-button--secondary",
      ),
      toolbarButton(t("Attach"), ICONS.attach, "notes-attach", () => void attachFile(), "ui-button--ghost"),
      save,
      del,
    );
    toolbar.append(left, right);

    if (error) wrapper.append(errorBanner(error));
    const titleRow = element("div", "notes-title-row");
    const icon = document.createElement("input");
    icon.className = "notes-icon-input";
    icon.value = selectedNote.icon || DEFAULT_NOTE_ICON;
    icon.placeholder = DEFAULT_NOTE_ICON;
    icon.maxLength = 8;
    icon.setAttribute("aria-label", t("Icon"));
    icon.title = t("Choose an icon");
    icon.dataset.notesIcon = "";
    const iconPicker = buildEmojiPicker({
      onPick: (emoji) => {
        icon.value = emoji;
        selectedNote.icon = emoji;
        markDirty();
      },
    });
    const iconBox = element("div", "notes-icon-box");
    iconBox.append(icon, iconPicker);
    icon.addEventListener("focus", () => {
      iconPicker.hidden = false;
    });
    icon.addEventListener("click", () => {
      iconPicker.hidden = false;
    });
    const title = document.createElement("input");
    title.className = "notes-title-input";
    title.value = selectedNote.title;
    title.placeholder = t("Note title");
    title.setAttribute("aria-label", t("Note title"));
    title.dataset.notesTitle = "";
    for (const input of [icon, title]) {
      input.addEventListener("input", markDirty);
    }
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !preview) {
        content?.querySelector("[data-notes-content]")?.focus();
      }
    });
    titleRow.append(iconBox, title);
    const tagEditor = buildTagEditor(selectedNote.tags);

    wrapper.append(toolbar, titleRow, tagEditor);
    if (focusTitleOnNextRender) {
      focusTitleOnNextRender = false;
      queueMicrotask(() => title.focus());
    }
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
    const icon = content.querySelector("[data-notes-icon]");
    const tags = content.querySelector("[data-notes-tags]");
    const body = content.querySelector("[data-notes-content]");
    if (title) selectedNote.title = title.value;
    if (icon) selectedNote.icon = icon.value.trim();
    if (tags) selectedNote.tags = parseTags(tags.value);
    if (body) selectedNote.content = body.value;
  }

  function markDirty() {
    dirty = true;
    const save = content?.querySelector("[data-notes-save]");
    if (save) save.disabled = false;
    scheduleAutosave();
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void saveEditor(), AUTOSAVE_DELAY_MS);
  }

  function currentSelection() {
    const textarea = content?.querySelector("[data-notes-content]");
    if (textarea && typeof textarea.selectionStart === "number") {
      return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
    }
    const selection = globalThis.getSelection?.();
    return (selection?.toString() || "").trim();
  }

  function buildTagEditor(initialTags) {
    const tags = [...initialTags];
    const container = element("div", "notes-tag-editor");
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.dataset.notesTags = "";
    const chips = element("div", "notes-tag-chips");
    container.append(element("span", "notes-tag-input-icon", TAG_ICON_FALLBACK), chips);
    const input = document.createElement("input");
    input.className = "notes-tag-input";
    input.placeholder = t("Add tag");
    input.setAttribute("aria-label", t("Add tag"));
    input.setAttribute("autocomplete", "off");
    container.append(input);
    const suggestions = element("div", "notes-tag-suggestions");
    suggestions.hidden = true;
    suggestions.setAttribute("role", "listbox");
    suggestions.setAttribute("aria-label", t("Add tag"));
    container.append(suggestions, hidden);

    function sync() {
      hidden.value = tags.join(", ");
      markDirty();
    }

    function renderChips() {
      chips.replaceChildren();
      for (const tag of tags) {
        const chip = element("span", "notes-tag-chip");
        chip.dataset.tagChip = tag;
        chip.append(element("span", "notes-tag-chip-icon", tagIcon(tag)));
        chip.append(element("span", "notes-tag-chip-name", tag));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "notes-tag-chip-remove";
        remove.title = t("Remove tag");
        remove.setAttribute("aria-label", `${t("Remove tag")} ${tag}`);
        remove.innerHTML = ICONS.close;
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          const index = tags.indexOf(tag);
          if (index >= 0) tags.splice(index, 1);
          sync();
          renderChips();
        });
        chip.append(remove);
        chips.append(chip);
      }
      hidden.value = tags.join(", ");
    }

    function renderSuggestions(query) {
      const needle = String(query).trim().toLowerCase();
      const pool = allTagSuggestions(snapshot.tags).filter(
        (name) => !tags.includes(name) && (!needle || name.toLowerCase().includes(needle)),
      );
      const candidate = String(query).trim().replace(/^#/, "");
      // Only offer to create a brand-new tag when the typed value matches no
      // existing suggestion; otherwise partial prefixes would pollute the list.
      if (
        candidate &&
        pool.length === 0 &&
        !tags.includes(candidate) &&
        !pool.includes(candidate)
      ) {
        pool.unshift(candidate);
      }
      suggestions.replaceChildren();
      if (pool.length === 0) {
        suggestions.hidden = true;
        return;
      }
      for (const name of pool.slice(0, 8)) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "notes-tag-suggestion";
        option.append(element("span", "notes-tag-chip-icon", tagIcon(name)));
        option.append(element("span", "", name));
        option.addEventListener("pointerdown", (event) => event.preventDefault());
        option.addEventListener("click", () => addTag(name));
        suggestions.append(option);
      }
      suggestions.hidden = false;
    }

    function addTag(value) {
      const name = String(value).trim().replace(/^#/, "");
      if (!name || tags.includes(name)) return;
      tags.push(name);
      input.value = "";
      sync();
      renderChips();
      suggestions.hidden = true;
      input.focus();
    }

    input.addEventListener("focus", () => renderSuggestions(input.value));
    input.addEventListener("input", () => renderSuggestions(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        if (input.value.trim()) addTag(input.value);
      } else if (event.key === "Backspace" && !input.value && tags.length) {
        tags.pop();
        sync();
        renderChips();
        suggestions.hidden = true;
      } else if (event.key === "Escape") {
        suggestions.hidden = true;
        input.blur();
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        suggestions.hidden = true;
      }, 120);
    });

    renderChips();
    return container;
  }

  function emptyLibrary() {
    if (sourceOnly) {
      const section = panel(
        t("Web clips"),
        t("No web clips yet. Capture a public page to collect it here."),
      );
      const actions = element("div", "notes-empty-actions");
      actions.append(
        button(t("Capture URL"), "", startCapture, "ui-button--primary"),
        button(t("Show all notes"), "", () => void applyFilter({}), "ui-button--ghost"),
      );
      section.append(actions);
      return section;
    }
    if (selectedTag) {
      const section = panel(
        `${t("Tag")} #${selectedTag}`,
        t("No notes match this tag yet."),
      );
      const actions = element("div", "notes-empty-actions");
      actions.append(
        button(t("New note"), "", () => void newNote(), "ui-button--primary"),
        button(t("Show all notes"), "", () => void applyFilter({}), "ui-button--ghost"),
      );
      section.append(actions);
      return section;
    }
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

  function hideEmojiPickers(target) {
    for (const picker of document.querySelectorAll(".notes-emoji-picker")) {
      if (picker.hidden) continue;
      const anchor = picker.closest(".notes-icon-box") || picker.parentElement;
      if (!picker.contains(target) && !anchor?.contains(target)) picker.hidden = true;
    }
  }

  function hideTagSuggestionsOutside(target) {
    for (const editor of document.querySelectorAll(".notes-tag-editor")) {
      const suggestions = editor.querySelector(".notes-tag-suggestions");
      if (!suggestions || suggestions.hidden) continue;
      if (!editor.contains(target)) suggestions.hidden = true;
    }
  }

  const onPointerDown = (event) => hideEmojiPickers(event.target);
  const onTagPointerDown = (event) => hideTagSuggestionsOutside(event.target);
  const onPickerEscape = (event) => {
    if (event.key !== "Escape") return;
    for (const picker of document.querySelectorAll(".notes-emoji-picker")) picker.hidden = true;
    for (const editor of document.querySelectorAll(".notes-tag-editor")) {
      const suggestions = editor.querySelector(".notes-tag-suggestions");
      if (suggestions) suggestions.hidden = true;
    }
  };
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointerdown", onTagPointerDown);
  document.addEventListener("keydown", onPickerEscape);

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
      clearTimeout(autosaveTimer);
      closeMovePopover();
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerdown", onTagPointerDown);
      document.removeEventListener("keydown", onPickerEscape);
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

function navButton(label, active, action, count = null, icon = null) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "notes-nav-item";
  control.classList.toggle("active", active);
  control.setAttribute("aria-pressed", String(active));
  if (icon) control.append(element("span", "notes-nav-item-icon", icon));
  control.append(element("span", "notes-nav-item-label", label));
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

function toolbarButton(label, iconMarkup, className, action, variant = "ui-button--ghost") {
  const control = document.createElement("button");
  control.type = "button";
  control.className = `ui-button ui-button--sm ${variant} ${className}`.trim();
  control.title = label;
  control.setAttribute("aria-label", label);
  const icon = document.createElement("span");
  icon.className = "notes-btn-icon";
  icon.innerHTML = iconMarkup;
  const text = element("span", "notes-btn-label", label);
  control.append(icon, text);
  control.addEventListener("click", action);
  return control;
}

function buildEmojiPicker({ onPick = () => {}, label = t("Choose an icon") } = {}) {
  const popover = element("div", "notes-emoji-picker");
  popover.hidden = true;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", label);
  const tabs = element("div", "notes-emoji-tabs");
  const grid = element("div", "notes-emoji-grid");
  let activeGroup = 0;

  function render(groupIndex) {
    activeGroup = groupIndex;
    tabs.replaceChildren();
    grid.replaceChildren();
    EMOJI_GROUPS.forEach(([name], index) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `notes-emoji-tab${index === activeGroup ? " active" : ""}`;
      tab.textContent = name;
      tab.setAttribute("aria-pressed", String(index === activeGroup));
      tab.addEventListener("click", () => render(index));
      tabs.append(tab);
    });
    for (const emoji of EMOJI_GROUPS[groupIndex][1]) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "notes-emoji-cell";
      cell.textContent = emoji;
      cell.setAttribute("aria-label", emoji);
      cell.addEventListener("click", () => {
        onPick(emoji);
        popover.hidden = true;
      });
      grid.append(cell);
    }
  }

  render(activeGroup);
  popover.append(tabs, grid);
  return popover;
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
    const url = gateway.attachmentUrl(activeSceneId, note, attachmentId);
    if (attribute === "href") {
      target.setAttribute("href", url);
      target.setAttribute("target", "_blank");
      target.setAttribute("rel", "noreferrer");
    } else {
      target.setAttribute("src", url);
      // If the image cannot load (e.g. attachment auth unavailable on mobile),
      // degrade to an explicit open-in-new-tab link instead of a broken image.
      target.addEventListener("error", () => {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.className = "notes-attachment-fallback";
        link.textContent = target.getAttribute("alt") || "Open attachment";
        target.replaceWith(link);
      });
    }
  }
}
