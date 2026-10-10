import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import type { GitDiff, GitDiffMode } from "./git-status";
import { parseWorkspaceDiff } from "./workspace-diff";

type ReadDiff = (workspace: string, mode: GitDiffMode) => Promise<GitDiff>;
interface Preview {
  diff?: GitDiff;
  receivedAt?: string;
  error?: string;
}

export function useWorkspaceDiff(
  workspace: string,
  mode: GitDiffMode | null,
  revision: number,
  reader: ReadDiff,
) {
  const [result, setResult] = useState<{
    workspace: string;
    mode: GitDiffMode;
    revision: number;
    reader: ReadDiff;
    preview: Preview;
  } | null>(null);
  useEffect(() => {
    if (!mode) return;
    let active = true;
    const scope = { workspace, mode, revision, reader };
    void (async () => {
      try {
        const diff = parseWorkspaceDiff(await reader(workspace, mode), mode);
        if (active)
          setResult({ ...scope, preview: { diff, receivedAt: new Date().toISOString() } });
      } catch (error) {
        if (active)
          setResult({
            ...scope,
            preview: {
              error:
                error instanceof Error && error.message === "git_output_too_large"
                  ? t("This diff exceeds the preview limit. Use your Git client to review it.")
                  : t(
                      "Could not load Git diff. Select a comparison to retry, or check your Git client.",
                    ),
            },
          });
      }
    })();
    return () => {
      active = false;
    };
  }, [workspace, mode, revision, reader]);
  return result?.workspace === workspace &&
    result.mode === mode &&
    result.revision === revision &&
    result.reader === reader
    ? result.preview
    : null;
}
