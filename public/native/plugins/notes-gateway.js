const DEFAULT_TIMEOUT_MS = 30_000;

export class NotesGateway {
  #fetch;
  #location;
  #timeoutMs;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Notes gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
    this.#timeoutMs = timeoutMs;
  }

  list(sceneId, workspaceId, filters = {}) {
    const url = this.#url("/v2/notes");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("workspaceId", workspaceId);
    if (filters.notebookId) url.searchParams.set("notebookId", filters.notebookId);
    if (filters.query) url.searchParams.set("query", filters.query);
    if (filters.tag) url.searchParams.set("tag", filters.tag);
    if (filters.sourceOnly) url.searchParams.set("sourceOnly", "true");
    return this.#request(url);
  }

  get(sceneId, workspaceId, notebookId, noteId) {
    const url = this.#url("/v2/notes/note");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("notebookId", notebookId);
    url.searchParams.set("noteId", noteId);
    return this.#request(url);
  }

  knowledge(sceneId, workspaceId) {
    const url = this.#url("/v2/notes/knowledge");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("workspaceId", workspaceId);
    return this.#request(url);
  }

  changes(sceneId, workspaceId, { cursor, limit = 100 } = {}) {
    const url = this.#url("/v2/notes/changes");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    return this.#request(url);
  }

  createNotebook(sceneId, workspaceId, { title, icon, parentId } = {}) {
    return this.#post("/v2/notes/notebooks", {
      sceneId,
      workspaceId,
      title,
      icon,
      parentId,
    });
  }

  updateNotebook(sceneId, workspaceId, { notebookId, title, icon } = {}) {
    return this.#post("/v2/notes/notebooks/update", {
      sceneId,
      workspaceId,
      notebookId,
      title,
      icon,
    });
  }

  deleteNotebook(sceneId, workspaceId, notebookId) {
    return this.#post("/v2/notes/notebooks/delete", {
      sceneId,
      workspaceId,
      notebookId,
    });
  }

  create(sceneId, workspaceId, notebookId, { title, content = "", tags = [], icon }) {
    return this.#post("/v2/notes/create", {
      sceneId,
      workspaceId,
      notebookId,
      title,
      content,
      tags,
      icon,
    });
  }

  save(sceneId, workspaceId, note) {
    return this.#post("/v2/notes/save", {
      sceneId,
      workspaceId,
      notebookId: note.notebookId,
      noteId: note.id,
      title: note.title,
      content: note.content,
      tags: note.tags,
      icon: note.icon,
      expectedVersion: note.version,
    });
  }

  delete(sceneId, workspaceId, note) {
    return this.#post("/v2/notes/delete", {
      sceneId,
      workspaceId,
      notebookId: note.notebookId,
      noteId: note.id,
      expectedVersion: note.version,
    });
  }

  moveNote(
    sceneId,
    workspaceId,
    { notebookId, noteId, targetNotebookId, expectedVersion } = {},
  ) {
    return this.#post("/v2/notes/move", {
      sceneId,
      workspaceId,
      notebookId,
      noteId,
      targetNotebookId,
      expectedVersion,
    });
  }

  capture(sceneId, workspaceId, notebookId, { url, title, tags = [] }) {
    return this.#post("/v2/notes/capture", {
      sceneId,
      workspaceId,
      notebookId,
      url,
      title,
      tags,
    });
  }

  uploadAttachment(sceneId, workspaceId, note, { fileName, mimeType, dataBase64 }) {
    return this.#post("/v2/notes/attachments", {
      sceneId,
      workspaceId,
      notebookId: note.notebookId,
      noteId: note.id,
      fileName,
      mimeType,
      dataBase64,
    });
  }

  attachmentUrl(sceneId, workspaceId, note, attachmentId) {
    const url = this.#url("/v2/notes/attachment");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("notebookId", note.notebookId);
    url.searchParams.set("noteId", note.id);
    url.searchParams.set("attachmentId", attachmentId);
    return url.toString();
  }

  importMarkdown(sceneId, workspaceId, notebookId, fileName, markdown) {
    return this.#post("/v2/notes/import-markdown", {
      sceneId,
      workspaceId,
      notebookId,
      fileName,
      markdown,
    });
  }

  exportBackup(sceneId, workspaceId, notebookId) {
    const url = this.#url("/v2/notes/export");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("notebookId", notebookId);
    return this.#request(url);
  }

  importBackup(sceneId, workspaceId, backup) {
    return this.#post("/v2/notes/import-backup", {
      sceneId,
      workspaceId,
      backup,
    });
  }

  rebuild(sceneId, workspaceId, notebookId) {
    return this.#post("/v2/notes/rebuild", {
      sceneId,
      workspaceId,
      notebookId,
    });
  }

  #post(path, body) {
    return this.#request(this.#url(path), {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  #url(path) {
    return new URL(path, this.#location?.origin ?? globalThis.location?.origin);
  }

  async #request(url, options = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        ...options,
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
        signal: controller?.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          body?.error?.message || body?.error?.code || `HTTP ${response.status}`,
        );
        error.code = body?.error?.code;
        throw error;
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Notes request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
