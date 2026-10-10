import type { ContextRecoverySnapshot } from "./context-recovery-repository";

/** Explicit user download. The exported file is plaintext for inspection and safekeeping. */
export function downloadContextRecovery(
  snapshot: ContextRecoverySnapshot,
  projectName: string,
): void {
  if (typeof URL.createObjectURL !== "function") {
    throw new Error("Project context recovery downloads are unavailable in this view.");
  }
  const content = JSON.stringify(
    {
      format: "zicode-project-context-draft",
      version: 1,
      projectName: snapshot.sourceProjectName ?? projectName,
      capturedAt: snapshot.sourceCapturedAt ?? snapshot.updatedAt,
      exportedAt: new Date().toISOString(),
      savedRevision: snapshot.savedRevision,
      draft: snapshot.draft,
      base: snapshot.base,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([`${content}\n`], { type: "application/json" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zicode-project-context-draft-${Date.now()}.json`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
