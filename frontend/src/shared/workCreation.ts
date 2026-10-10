export interface WorkCreationRequest {
  sequence: number;
  projectPath: string;
}

/** UI intent only: the receiving form owns validation, saving and execution settings. */
export function requestProjectWork(kind: "task" | "automation", projectPath: string): void {
  window.dispatchEvent(
    new CustomEvent("zicode:create-project-work", { detail: { kind, projectPath } }),
  );
}
