import { create } from "zustand";
import type {
  AutomationDraft,
  AutomationDraftFields,
} from "../../../../extensions/automation-drafts";
import { t } from "../../shared/i18n.js";
import type { AutomationAppOptions } from "./store";

export type { AutomationDraft, AutomationDraftFields };
export function automationDraftScope(
  target: ReturnType<NonNullable<AutomationAppOptions["getTarget"]>>,
) {
  return JSON.stringify([
    target?.sceneId ?? "",
    target?.workspaceId ?? "",
    target?.instanceId ?? "",
    target?.cwd ?? "",
  ]);
}
export interface DraftSelection {
  draft: AutomationDraft;
  revision: string;
}

function message(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/automation_draft_conflict/.test(raw))
    return t("Drafts changed. Refresh the list and restore the latest draft before saving again.");
  if (/automation_draft_busy/.test(raw)) return t("Draft storage is busy. Try again shortly.");
  if (/automation_draft_(invalid|too_large|limit)/.test(raw))
    return t(
      "Draft storage or content is invalid or exceeds its limit. Existing drafts were not replaced.",
    );
  return raw;
}

export function createAutomationDraftStore(options: AutomationAppOptions) {
  const scopeKey = () => automationDraftScope(options.getTarget?.() ?? null);
  const callForCurrentTarget = () => {
    const target = options.getTarget?.();
    return (operation: string, params: unknown) => {
      if (options.getTarget && !target)
        return Promise.reject(new Error("No active session for automation request"));
      return options.call(operation, params, target ? { target } : undefined);
    };
  };
  let scope = scopeKey();
  let sequence = 0;
  return create<{
    epoch: number;
    drafts: AutomationDraft[];
    revision: string | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
    syncScope(): void;
    load(): Promise<void>;
    save(
      fields: AutomationDraftFields,
      selection?: DraftSelection,
    ): Promise<DraftSelection | undefined>;
    remove(id: string): Promise<void>;
  }>()((set, get) => {
    const current = (epoch: number) => get().epoch === epoch && scope === scopeKey();
    async function mutate(params: Record<string, unknown>) {
      const epoch = get().epoch;
      if (!current(epoch) || !get().revision || get().loading || get().saving) return;
      const fixedCall = callForCurrentTarget();
      set({ saving: true, error: null });
      try {
        const response = await fixedCall("automation_drafts", params);
        if (!current(epoch)) return;
        if (!response?.ok || !response.data?.revision || !Array.isArray(response.data.drafts))
          throw new Error(response?.error || t("Could not save automation draft"));
        set({ drafts: response.data.drafts, revision: response.data.revision });
        return response.data.draft
          ? { draft: response.data.draft, revision: response.data.revision }
          : undefined;
      } catch (error) {
        if (current(epoch)) set({ error: message(error) });
      } finally {
        if (current(epoch)) set({ saving: false });
      }
    }
    return {
      epoch: 0,
      drafts: [],
      revision: null,
      loading: false,
      saving: false,
      error: null,
      syncScope() {
        if (scope === scopeKey()) return;
        scope = scopeKey();
        sequence += 1;
        set({
          epoch: get().epoch + 1,
          drafts: [],
          revision: null,
          loading: false,
          saving: false,
          error: null,
        });
      },
      async load() {
        get().syncScope();
        if (get().saving) return;
        const epoch = get().epoch;
        const request = ++sequence;
        const fixedCall = callForCurrentTarget();
        set({ loading: true, error: null });
        try {
          const response = await fixedCall("automation_drafts", { action: "list" });
          if (!current(epoch) || request !== sequence) return;
          if (!response?.ok || !response.data?.revision || !Array.isArray(response.data.drafts))
            throw new Error(response?.error || t("Could not load automation drafts"));
          set({ drafts: response.data.drafts, revision: response.data.revision });
        } catch (error) {
          if (current(epoch) && request === sequence)
            set({ error: message(error), revision: null });
        } finally {
          if (current(epoch) && request === sequence) set({ loading: false });
        }
      },
      save(fields, selection) {
        return mutate({
          action: "upsert",
          id: selection?.draft.id,
          draft: fields,
          expectedRevision: selection?.revision ?? get().revision,
        });
      },
      async remove(id) {
        const epoch = get().epoch;
        const revision = get().revision;
        const confirmed = await (options.confirmRemove?.(t("Delete this automation draft?")) ??
          globalThis.confirm?.(t("Delete this automation draft?")) ??
          false);
        if (confirmed && current(epoch))
          await mutate({ action: "remove", id, expectedRevision: revision });
      },
    };
  });
}
