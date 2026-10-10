import type { NotesStoreOptions } from "./notesStore";

export function createNotesOperationScope(getTarget: NonNullable<NotesStoreOptions["getTarget"]>) {
  let generation = 0;
  let disposed = false;
  const target = () => ({
    sceneId: getTarget()?.sceneId ?? "programming",
    workspaceId: getTarget()?.workspaceId ?? "",
  });
  return {
    invalidate() {
      generation += 1;
    },
    destroy() {
      disposed = true;
      generation += 1;
    },
    capture() {
      const captured = target();
      const epoch = generation;
      return {
        ...captured,
        isCurrent: () => {
          const live = target();
          return (
            !disposed &&
            generation === epoch &&
            live.sceneId === captured.sceneId &&
            live.workspaceId === captured.workspaceId
          );
        },
      };
    },
  };
}
export type NotesOperationScope = ReturnType<
  ReturnType<typeof createNotesOperationScope>["capture"]
>;
