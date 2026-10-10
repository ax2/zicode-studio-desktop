export interface ProjectChatDraft {
  workspace: string;
  scene?: string;
  prompt: string;
  isCurrent?(): boolean;
}
export type PrepareProjectChatDraft = (draft: ProjectChatDraft) => Promise<void>;
