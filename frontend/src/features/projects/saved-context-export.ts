import type { ProjectProfile } from "./logic";

/** Manual, plaintext copy of the saved project context. */
export function downloadSavedProjectContext(profile: ProjectProfile, projectName: string): void {
  if (typeof URL.createObjectURL !== "function")
    throw new Error("Project context downloads are unavailable in this view.");
  const content = JSON.stringify(
    {
      format: "zicode-project-context-profile",
      version: 1,
      projectName,
      capturedAt: new Date().toISOString(),
      profile,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([`${content}\n`], { type: "application/json" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zicode-project-context-${Date.now()}.json`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
