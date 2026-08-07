import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { PillText } from "./ProjectHeaderApp";

export interface ProjectHeaderInfo {
  path?: string;
  gitBranch?: string | null;
}

export interface ProjectHeaderHostData {
  workspaceInfo(
    workspaceId: string,
  ): Promise<{ info?: ProjectHeaderInfo | null }>;
}

export async function setupProjectHeader({
  data,
  workspaceId,
}: {
  data: ProjectHeaderHostData;
  workspaceId: string;
}): Promise<void> {
  const workspaceEl = document.getElementById("workspace-indicator");
  const branchEl = document.getElementById("git-branch-indicator");
  if (!workspaceEl && !branchEl) return;

  let info: ProjectHeaderInfo | undefined;
  try {
    const response = await data.workspaceInfo(workspaceId);
    info = response?.info ?? undefined;
  } catch {
    // Network or host error — leave pills hidden.
    return;
  }
  if (!info) return;

  if (workspaceEl && info.path) {
    const path = info.path;
    const root = createRoot(workspaceEl);
    flushSync(() => {
      root.render(createElement(PillText, { text: path }));
    });
    workspaceEl.title = path;
    workspaceEl.classList.remove("hidden");
  }

  if (branchEl) {
    if (info.gitBranch) {
      const branch = info.gitBranch;
      const root = createRoot(branchEl);
      flushSync(() => {
        root.render(createElement(PillText, { text: branch }));
      });
      branchEl.classList.remove("hidden");
    } else {
      branchEl.classList.add("hidden");
    }
  }
}
