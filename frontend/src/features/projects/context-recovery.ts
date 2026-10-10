import type { PreparedContextRecovery } from "./context-recovery-import";
import {
  type ContextRecoveryRepository,
  type ContextRecoverySnapshot,
  createContextRecoveryRepository,
} from "./context-recovery-repository";
import type { ProjectProfile } from "./logic";

interface RecoveryView {
  snapshots: ContextRecoverySnapshot[];
  unreadable: number;
  removableUnreadable: number;
  pending: boolean;
  error: string | null;
}

const failureMessage =
  "Local project context recovery is unavailable. Keep this window open until you save the context.";
const capacityMessage =
  "Local project context recovery is full. Discard old copies before closing this window.";
const randomId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export function createContextRecovery({
  onChange,
  repository = createContextRecoveryRepository(),
}: {
  onChange(view: RecoveryView): void;
  repository?: ContextRecoveryRepository;
}) {
  const ids = new Map<string, string>();
  const pending = new Map<string, ContextRecoverySnapshot>();
  const known = new Map<string, ContextRecoverySnapshot>();
  let loaded: ContextRecoverySnapshot[] = [];
  let unreadable = 0;
  let unreadableRecords: Array<{ id: string; revision: string }> = [];
  let activeScope = "";
  let readGeneration = 0;
  let queuedWrites = 0;
  let error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue = Promise.resolve();

  function publish() {
    const merged = new Map(loaded.map((item) => [item.id, item]));
    for (const item of known.values()) if (item.scope === activeScope) merged.set(item.id, item);
    onChange({
      snapshots: [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      unreadable,
      removableUnreadable: unreadableRecords.length,
      pending: pending.size + queuedWrites > 0,
      error,
    });
  }

  function enqueue(action: () => Promise<void>) {
    queue = queue.then(action).catch((reason) => {
      error =
        reason instanceof Error && reason.message === "Context recovery capacity reached"
          ? capacityMessage
          : failureMessage;
      publish();
    });
    return queue;
  }

  async function activate(scope: string) {
    const changed = scope !== activeScope;
    activeScope = scope;
    if (changed) {
      loaded = [];
      unreadable = 0;
      unreadableRecords = [];
      publish();
    }
    const generation = ++readGeneration;
    if (!scope) {
      publish();
      return;
    }
    try {
      const result = await repository.list(scope);
      if (generation !== readGeneration || scope !== activeScope) return;
      error = result.unreadable
        ? "Some local project context recovery copies could not be read."
        : pending.size && (error === failureMessage || error === capacityMessage)
          ? error
          : null;
      loaded = result.snapshots;
      unreadable = result.unreadable;
      unreadableRecords = result.unreadableRecords;
      publish();
    } catch {
      if (generation !== readGeneration || scope !== activeScope) return;
      error = failureMessage;
      publish();
    }
  }

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    const batch = [...pending.values()];
    pending.clear();
    queuedWrites += batch.length;
    publish();
    return enqueue(async () => {
      for (const snapshot of batch) {
        try {
          await repository.put(snapshot);
          if (known.get(snapshot.scope)?.revision === snapshot.revision) {
            known.delete(snapshot.scope);
          }
        } catch (reason) {
          if (!pending.has(snapshot.scope)) pending.set(snapshot.scope, snapshot);
          error =
            reason instanceof Error && reason.message === "Context recovery capacity reached"
              ? capacityMessage
              : failureMessage;
        } finally {
          queuedWrites -= 1;
        }
      }
      if (!pending.size && !queuedWrites && error === failureMessage) error = null;
      await activate(activeScope);
    });
  }

  return {
    activate,
    async importCopy(scope: string, copy: PreparedContextRecovery) {
      if (!scope) throw new Error("Project context recovery has no destination.");
      const snapshot: ContextRecoverySnapshot = {
        id: randomId(),
        scope,
        revision: randomId(),
        updatedAt: new Date().toISOString(),
        draft: structuredClone(copy.draft),
        base: structuredClone(copy.base),
        savedRevision: null,
        sourceProjectName: copy.projectName,
        sourceCapturedAt: copy.capturedAt,
      };
      let failure: unknown;
      await enqueue(async () => {
        try {
          await repository.put(snapshot);
          if (scope === activeScope) await activate(scope);
        } catch (reason) {
          failure = reason;
          throw reason;
        }
      });
      if (failure) throw failure;
    },
    remember(
      scope: string,
      draft: ProjectProfile,
      base: ProjectProfile,
      savedRevision: string | null,
    ) {
      if (!scope) return;
      let id = ids.get(scope);
      if (!id) {
        id = randomId();
        ids.set(scope, id);
      }
      const snapshot: ContextRecoverySnapshot = {
        id,
        scope,
        revision: randomId(),
        updatedAt: new Date().toISOString(),
        draft: structuredClone(draft),
        base: structuredClone(base),
        savedRevision,
      };
      pending.set(scope, snapshot);
      known.set(scope, snapshot);
      publish();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), 250);
    },
    flush,
    forgetOwn(scope: string) {
      const id = ids.get(scope);
      if (!id) return Promise.resolve();
      ids.delete(scope);
      pending.delete(scope);
      known.delete(scope);
      loaded = loaded.filter((item) => item.id !== id);
      publish();
      return enqueue(async () => {
        await repository.remove(id, undefined, scope);
        await activate(activeScope);
      });
    },
    discard(snapshot: ContextRecoverySnapshot) {
      if (snapshot.scope !== activeScope) return Promise.resolve();
      if (ids.get(snapshot.scope) === snapshot.id) {
        ids.delete(snapshot.scope);
        pending.delete(snapshot.scope);
        known.delete(snapshot.scope);
      }
      loaded = loaded.filter((item) => item.id !== snapshot.id);
      publish();
      return enqueue(async () => {
        await repository.remove(snapshot.id, snapshot.revision, snapshot.scope);
        await activate(activeScope);
      });
    },
    discardUnreadable(scope: string) {
      if (scope !== activeScope) return Promise.resolve();
      const records = [...unreadableRecords];
      unreadableRecords = [];
      return enqueue(async () => {
        for (const record of records) {
          await repository.remove(record.id, record.revision, scope);
        }
        await activate(activeScope);
      });
    },
    isCurrent(id: string) {
      return ids.get(activeScope) === id;
    },
  };
}
