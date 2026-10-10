import { directoryScope } from "./directory-context";
import type { ProjectProfile, ProjectTarget } from "./logic";
import type { ProfileField } from "./project-profile-merge";

const MAX_SCOPES = 32;

export interface ContextDraftRecord {
  draft: ProjectProfile;
  base: ProjectProfile;
  revision: string | null;
  conflicts: ProfileField[];
}

/** Window-local drafts stay separate from the saved project profile. */
export function createContextDraftMemory() {
  const drafts = new Map<string, ContextDraftRecord>();
  return {
    read(target: ProjectTarget | null): ContextDraftRecord | null {
      const scope = directoryScope(target);
      const draft = drafts.get(scope) ?? null;
      if (draft) {
        drafts.delete(scope);
        drafts.set(scope, draft);
      }
      return draft;
    },
    write(target: ProjectTarget | null, draft: ContextDraftRecord | null): void {
      const scope = directoryScope(target);
      drafts.delete(scope);
      if (!draft) return;
      drafts.set(scope, draft);
      if (drafts.size > MAX_SCOPES) drafts.delete(drafts.keys().next().value as string);
    },
  };
}
