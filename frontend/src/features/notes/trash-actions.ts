import { t } from "../../shared/i18n";
import type { TrashEntry } from "./notesLogic";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export interface TrashExpectation {
  version: string | number;
  deletedAt: string;
  trashToken?: string;
}
export const trashEntryKey = (entry: TrashEntry) =>
  JSON.stringify([
    entry.notebookId,
    entry.note.id,
    entry.note.version,
    entry.deletedAt,
    entry.trashToken,
  ]);
export function createTrashActions({
  get,
  set,
  gateway,
  capture,
  notify,
  localize,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  capture(): NotesOperationScope;
  notify(message: string): void;
  localize(error: unknown): Error;
}) {
  let readSequence = 0;
  let writeSequence = 0;
  async function read(scope: NotesOperationScope) {
    if (!scope.isCurrent()) return;
    const request = ++readSequence;
    const current = () => scope.isCurrent() && request === readSequence;
    set({ trashLoading: true, trashError: null });
    try {
      const response = await gateway.listTrash(scope.sceneId, scope.workspaceId);
      if (current()) set({ trash: response.trash ?? [], trashLoaded: true });
    } catch (error) {
      if (current()) set({ trashError: localize(error).message, trashLoaded: false });
    } finally {
      if (current()) set({ trashLoading: false });
    }
  }
  async function mutate(kind: "restore" | "purge", entries: TrashEntry[], batch = false) {
    const scope = capture();
    if (
      !scope.isCurrent() ||
      get().trashBusy ||
      get().trashLoading ||
      !get().trashLoaded ||
      !entries.length
    )
      return;
    const currentKeys = new Set(get().trash.map(trashEntryKey));
    if (
      entries.some(
        (entry) =>
          !currentKeys.has(trashEntryKey(entry)) || !entry.note.version || !entry.deletedAt,
      )
    ) {
      set({ trashError: t("The trash entry changed. Refresh the trash before trying again.") });
      return;
    }
    const request = ++writeSequence;
    readSequence += 1;
    const current = () => scope.isCurrent() && request === writeSequence;
    set({ trashBusy: true, trashError: null });
    let completed = 0;
    let firstError: Error | null = null;
    try {
      for (const entry of entries) {
        if (!current()) return;
        const expected: TrashExpectation = {
          version: entry.note.version as string | number,
          deletedAt: entry.deletedAt,
          trashToken: entry.trashToken,
        };
        try {
          if (kind === "restore")
            await gateway.restoreTrash(
              scope.sceneId,
              scope.workspaceId,
              entry.notebookId,
              entry.note.id,
              expected,
            );
          else
            await gateway.purgeTrash(
              scope.sceneId,
              scope.workspaceId,
              entry.notebookId,
              entry.note.id,
              expected,
            );
          if (!current()) return;
          completed += 1;
          set({
            trash: get().trash.filter((item) => trashEntryKey(item) !== trashEntryKey(entry)),
          });
        } catch (error) {
          firstError ??= localize(error);
        }
      }
      if (!current()) return;
      if (kind === "restore" && completed) await get().load({ preserveSelection: true });
      if (!current()) return;
      await read(scope);
      if (!current()) return;
      if (firstError) set({ trashError: firstError.message });
      if (completed)
        notify(
          kind === "restore"
            ? t("Note restored")
            : batch
              ? t("Permanently deleted {count} displayed trash items.").replace(
                  "{count}",
                  String(completed),
                )
              : t("Note permanently deleted"),
        );
    } finally {
      if (current()) set({ trashBusy: false });
    }
  }
  return {
    async loadTrash() {
      if (!get().trashBusy) await read(capture());
    },
    restoreFromTrash: (entry: TrashEntry) => mutate("restore", [entry]),
    purgeFromTrash: (entry: TrashEntry) => mutate("purge", [entry]),
    emptyTrash: () => mutate("purge", [...get().trash], true),
  };
}
