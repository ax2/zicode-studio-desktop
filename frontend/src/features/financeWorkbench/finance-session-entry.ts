import { create } from "zustand";

// The workbench remounts its view on locale changes. Keep the opening operation
// with its controller so a remount cannot erase an error or start a duplicate.
export function createFinanceSessionEntry(openSession: () => Promise<unknown>) {
  let active = true, pending: Promise<void> | null = null;
  return create<{
    busy: boolean; failed: boolean;
    open(): Promise<void>;
    destroy(): void;
  }>((set) => ({
    busy: false, failed: false,
    open() {
      if (!active) return Promise.resolve();
      if (pending) return pending;
      set({ busy: true, failed: false });
      pending = Promise.resolve().then(() => active ? openSession() : undefined).then(result => {
        if (result === false || (result && typeof result === "object" && "ok" in result && result.ok === false)) {
          throw new Error("finance_session_unavailable");
        }
      }).catch(() => {
        if (active) set({ failed: true });
      }).finally(() => {
        pending = null;
        if (active) set({ busy: false });
      });
      return pending;
    },
    destroy() { active = false; },
  }));
}
export type FinanceSessionEntryStore = ReturnType<typeof createFinanceSessionEntry>;
