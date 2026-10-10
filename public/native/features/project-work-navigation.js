/** Bind project creation intents to existing center forms. This performs no service writes. */
export function installProjectWorkNavigation({
  events = window,
  activate,
  taskCenter,
  automation,
}) {
  const listener = (event) => {
    const { kind, projectPath } = event.detail ?? {};
    if (typeof projectPath !== "string" || !projectPath || projectPath.includes("\0")) return;
    if (kind === "task") {
      taskCenter.newTask(projectPath);
      activate("com.zicode.tasks");
    } else if (kind === "automation") {
      automation.newWorkflow(projectPath);
      activate("com.zicode.automation");
    }
  };
  events.addEventListener("zicode:create-project-work", listener);
  return () => events.removeEventListener("zicode:create-project-work", listener);
}
