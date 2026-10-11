import { normalizeResourceAdmission } from "./resource-call-admission.js";
const LIMIT = 128;
const text = value => typeof value === "string" && value.length > 0 && value.length <= 256;
const scopeKey = scope => JSON.stringify([scope?.sceneId ?? "programming", scope?.workspaceId]);
export function resourceCallRecord(target, owner, ticket, createdAt = Date.now(), label = "") {
  if (!text(target?.workspaceId) || !text(target?.sceneId ?? "programming") ||
      !["runtimeId", "sessionId", "pluginId", "capabilityId"].every(key => text(owner?.[key])) ||
      target.instanceId !== owner.runtimeId || target.sessionId !== owner.sessionId ||
      !Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error("[resource_journal_invalid]");
  const cleanOwner = Object.fromEntries(["runtimeId", "sessionId", "pluginId", "capabilityId"].map(key => [key, owner[key]]));
  const cleanTicket = normalizeResourceAdmission({ ...ticket, schemaVersion: 1, profile: "resource.call.admission.draft1",
    owner: cleanOwner, persistent: false, phase: "prepared", expiresInSeconds: 60 }, cleanOwner);
  const scope = { sceneId: target.sceneId ?? "programming", workspaceId: target.workspaceId };
  return { schemaVersion: 1, id: `${cleanTicket.hostInstanceId}:${cleanTicket.callId}`, scope,
    scopeKey: scopeKey(scope), owner: cleanOwner, ticket: cleanTicket, createdAt,
    label: text(label) ? label : `${cleanOwner.pluginId} · ${cleanOwner.capabilityId}` };
}
function parse(record) {
  const clean = resourceCallRecord({ ...record?.scope, instanceId: record?.owner?.runtimeId, sessionId: record?.owner?.sessionId },
    record?.owner, record?.ticket, record?.createdAt, record?.label);
  if (record?.schemaVersion !== 1 || record.id !== clean.id || record.scopeKey !== clean.scopeKey)
    throw new Error("[resource_journal_invalid]");
  return clean;
}
export function createResourceCallJournal({ indexedDB = globalThis.indexedDB } = {}) {
  let database;
  function open() {
    database ??= new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error("[resource_journal_unavailable]")); return; }
      const request = indexedDB.open("zicode-resource-calls-v1", 1);
      let cancelled = false;
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("calls", { keyPath: "id" });
        store.createIndex("scopeKey", "scopeKey");
      };
      request.onblocked = () => { cancelled = true; reject(new Error("[resource_journal_unavailable]")); };
      request.onerror = () => reject(new Error("[resource_journal_unavailable]"));
      request.onsuccess = () => {
        if (cancelled) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); database = undefined; };
        resolve(request.result);
      };
    }).catch(error => { database = undefined; throw error; });
    return database;
  }
  async function transaction(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("calls", mode); let value; let failure;
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(failure ?? new Error("[resource_journal_unavailable]"));
      const set = result => { value = result; };
      const abort = error => { failure = error; tx.abort(); };
      try { action(tx.objectStore("calls"), set, abort); } catch (error) { abort(error); }
    });
  }
  return {
    async keep(target, owner, ticket, label) {
      const record = resourceCallRecord(target, owner, ticket, Date.now(), label);
      await transaction("readwrite", (store, set, abort) => {
        const existing = store.get(record.id);
        existing.onsuccess = () => {
          if (existing.result) { abort(new Error("[resource_call_duplicate]")); return; }
          const count = store.count();
          count.onsuccess = () => {
            if (count.result >= LIMIT) { abort(new Error("[resource_journal_full]")); return; }
            const pending = store.index("scopeKey").getAll(record.scopeKey, LIMIT);
            pending.onsuccess = () => {
              try {
                if (pending.result.map(parse).some(item => JSON.stringify(item.owner) === JSON.stringify(record.owner))) {
                  abort(new Error("[resource_journal_pending]")); return;
                }
                store.add(record); set(record);
              } catch (error) { abort(error); }
            };
          };
        };
      });
      return record;
    },
    async list(scope) {
      if (!text(scope?.workspaceId)) throw new Error("[resource_journal_invalid]");
      return transaction("readonly", (store, set, abort) => {
        const request = store.index("scopeKey").getAll(scopeKey(scope), LIMIT + 1);
        request.onsuccess = () => {
          try {
            if (request.result.length > LIMIT) throw new Error("[resource_journal_invalid]");
            set(request.result.map(parse).sort((a, b) => b.createdAt - a.createdAt));
          } catch (error) { abort(error); }
        };
      });
    },
    async remove(record) {
      const clean = parse(record);
      await transaction("readwrite", (store, set, abort) => {
        const request = store.get(clean.id);
        request.onsuccess = () => {
          if (!request.result) return;
          try {
            const saved = parse(request.result);
            if (JSON.stringify(saved) !== JSON.stringify(clean)) throw new Error("[resource_journal_invalid]");
            store.delete(clean.id); set(true);
          } catch (error) { abort(error); }
        };
      });
    },
  };
}
