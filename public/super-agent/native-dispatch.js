// Native Agent Inbox dispatch.
//
// When a task is approved in the Runtime panel the component emits an
// `sa-dispatch` DOM event. This module turns that into a real background agent
// run in the *target project* using the native host protocol:
//
//   1. resolveWorkspace(targetProject)  -> stable workspaceId (registers root)
//   2. spawnSession(workspaceId)        -> headless runtime target
//   3. runtime prompt on that target    -> the project agent starts working
//
// The child session begins with a temporary id; the host emits `session_bound`
// with the persisted id shortly after the first prompt, which the caller wires
// back into the task via `markTaskChildSessionBound`. Recording the child
// target is what lets "View Session ->" navigate to the running work and, more
// importantly, makes the dispatched run show up as a real session inside the
// target project.

import {
  buildProjectAgentPrompt,
  markTaskChildSessionBound,
  markTaskDispatchTarget,
  markTaskFinished,
} from "./task-state.js";

export async function dispatchSuperAgentTaskNative({
  task,
  resolveWorkspace,
  spawnSession,
  sendPrompt,
  resolveBoundTarget = null,
  updateTask,
  registerDispatchTarget = null,
  idempotencyKey = null,
  onDispatchError = null,
  logger = console,
}) {
  if (!task || task.status === "draft") return null;
  const targetProject = task.targetProject || task.dispatch?.targetProject;
  if (!targetProject) {
    logger?.warn?.("[SuperAgent] dispatch skipped: task has no targetProject", task.id);
    return null;
  }

  let target = null;
  try {
    const workspaceId = await resolveWorkspace(targetProject);
    target = await spawnSession(workspaceId);

    // Persist the routing target before the prompt so a crash mid-dispatch
    // still leaves a breadcrumb the user can inspect.
    const dispatched = await updateTask(task.id, (current) => {
      if (
        !["pending", "running"].includes(current.status) ||
        (current.targetProject || current.dispatch?.targetProject) !== targetProject ||
        (current.dispatch?.childInstanceId && current.dispatch.childInstanceId !== target.instanceId)
      ) return null;
      return markTaskDispatchTarget(current, {
        childWorkspaceId: target.workspaceId,
        childInstanceId: target.instanceId,
        childSessionId: target.sessionId,
      });
    });
    // A second window may have cancelled, removed, or already dispatched the
    // task while this child runtime was starting. Never prompt an orphan.
    if (!dispatched) return null;

    // Let the caller map the child instance -> task so `session_bound` events
    // can upgrade the temporary child session id to the persisted one.
    registerDispatchTarget?.(target, task.id);

    await sendPrompt(target, buildProjectAgentPrompt(dispatched), { idempotencyKey });

    // A fresh Pi runtime upgrades its temporary id when the host serves a
    // snapshot. Confirm the binding so the task can navigate to the saved
    // session; the separate session_bound event remains a recovery path.
    if (resolveBoundTarget) {
      try {
        const boundTarget = await resolveBoundTarget(target);
        if (
          boundTarget?.sessionId &&
          boundTarget.workspaceId === target.workspaceId &&
          boundTarget.instanceId === target.instanceId &&
          boundTarget.sessionId !== target.sessionId
        ) {
          target = { ...target, ...boundTarget };
          await updateTask(task.id, (current) =>
            current.dispatch?.childInstanceId === target.instanceId
              ? markTaskChildSessionBound(current, { childSessionId: target.sessionId })
              : null,
          );
        }
      } catch (error) {
        // The prompt has already been accepted. A lost snapshot or task-file
        // conflict must not mark a working child agent as failed; the
        // session_bound event can still complete the link.
        logger?.warn?.("[SuperAgent] could not confirm child session binding:", error);
      }
    }
    return { task: dispatched, target };
  } catch (error) {
    logger?.error?.("[SuperAgent] native dispatch failed:", error);
    await updateTask(task.id, (current) => {
      if (
        !["pending", "running"].includes(current.status) ||
        (current.targetProject || current.dispatch?.targetProject) !== targetProject ||
        (target?.instanceId && current.dispatch?.childInstanceId && current.dispatch.childInstanceId !== target.instanceId)
      ) return null;
      return markTaskFinished(current, {
        status: "failed",
        failReason: errorMessage(error),
      });
    }).catch((updateError) => {
      logger?.warn?.("[SuperAgent] failed to mark dispatch failed:", updateError);
    });
    onDispatchError?.(task, error);
    return null;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Dispatch failed");
}
