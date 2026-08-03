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

  list(sceneId, filters = {}) {
    const url = this.#url("/v2/notes");
    url.searchParams.set("sceneId", sceneId);
    if (filters.notebookId) url.searchParams.set("notebookId", filters.notebookId);
    if (filters.query) url.searchParams.set("query", filters.query);
    if (filters.tag) url.searchParams.set("tag", filters.tag);
    if (filters.sourceOnly) url.searchParams.set("sourceOnly", "true");
    return this.#request(url);
  }

  get(sceneId, notebookId, noteId) {
    const url = this.#url("/v2/notes/note");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("notebookId", notebookId);
    url.searchParams.set("noteId", noteId);
    return this.#request(url);
  }

  knowledge(sceneId) {
    const url = this.#url("/v2/notes/knowledge");
    url.searchParams.set("sceneId", sceneId);
    return this.#request(url);
  }

  changes(sceneId, { cursor, limit = 100 } = {}) {
    const url = this.#url("/v2/notes/changes");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    return this.#request(url);
  }

  createNotebook(sceneId, title) {
    return this.#post("/v2/notes/notebooks", { sceneId, title });
  }

  create(sceneId, notebookId, { title, content = "", tags = [] }) {
    return this.#post("/v2/notes/create", {
      sceneId,
      notebookId,
      title,
      content,
      tags,
    });
  }

  save(sceneId, note) {
    return this.#post("/v2/notes/save", {
      sceneId,
      notebookId: note.notebookId,
      noteId: note.id,
      title: note.title,
      content: note.content,
      tags: note.tags,
      expectedVersion: note.version,
    });
  }

  delete(sceneId, note) {
    return this.#post("/v2/notes/delete", {
      sceneId,
      notebookId: note.notebookId,
      noteId: note.id,
      expectedVersion: note.version,
    });
  }

  capture(sceneId, notebookId, { url, title, tags = [] }) {
    return this.#post("/v2/notes/capture", {
      sceneId,
      notebookId,
      url,
      title,
      tags,
    });
  }

  uploadAttachment(sceneId, note, { fileName, mimeType, dataBase64 }) {
    return this.#post("/v2/notes/attachments", {
      sceneId,
      notebookId: note.notebookId,
      noteId: note.id,
      fileName,
      mimeType,
      dataBase64,
    });
  }

  attachmentUrl(sceneId, note, attachmentId) {
    const url = this.#url("/v2/notes/attachment");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("notebookId", note.notebookId);
    url.searchParams.set("noteId", note.id);
    url.searchParams.set("attachmentId", attachmentId);
    return url.toString();
  }

  importMarkdown(sceneId, notebookId, fileName, markdown) {
    return this.#post("/v2/notes/import-markdown", {
      sceneId,
      notebookId,
      fileName,
      markdown,
    });
  }

  exportBackup(sceneId, notebookId) {
    const url = this.#url("/v2/notes/export");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("notebookId", notebookId);
    return this.#request(url);
  }

  importBackup(sceneId, backup) {
    return this.#post("/v2/notes/import-backup", { sceneId, backup });
  }

  rebuild(sceneId, notebookId) {
    return this.#post("/v2/notes/rebuild", { sceneId, notebookId });
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
