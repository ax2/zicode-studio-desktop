// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  buildProjectAgentPrompt,
  buildSuperAgentNotificationPrompt,
  buildTaskComposerPrompt,
  findDispatchedTaskByInstanceId,
  looksLikeQuestion,
  markTaskAnswered,
  markTaskFinished,
  markTaskForDispatch,
  markTaskNeedsInput,
  markTaskPaused,
  markTaskResumed,
  normalizeSuperAgentTasks,
  shouldCompleteDispatchedRun,
} from "./task-state.js";

describe("super-agent task state", () => {
  it("detects short question-style final messages", () => {
    expect(looksLikeQuestion("请确认输出目录？")).toBe(true);
    expect(looksLikeQuestion("Use directory A or B?")).toBe(true);
    expect(looksLikeQuestion("用 A？ ")).toBe(true);
    expect(looksLikeQuestion("已生成 3 篇文章，请查看。")).toBe(false);
    expect(looksLikeQuestion("OK")).toBe(false);
    expect(looksLikeQuestion("")).toBe(false);
    expect(looksLikeQuestion(`${"长".repeat(241)}？`)).toBe(false);
  });

  it("completes dispatched runs only on a final agent_end or full settle", () => {
    expect(shouldCompleteDispatchedRun("agent_end", false)).toBe(true);
    expect(shouldCompleteDispatchedRun("agent_end", undefined)).toBe(true);
    expect(shouldCompleteDispatchedRun("agent_end", true)).toBe(false);
    expect(shouldCompleteDispatchedRun("agent_settled", true)).toBe(true);
    expect(shouldCompleteDispatchedRun("agent_settled", undefined)).toBe(true);
    expect(shouldCompleteDispatchedRun("agent_start", false)).toBe(false);
    expect(shouldCompleteDispatchedRun("message_end", false)).toBe(false);
  });

  it("finds a dispatched task by its persisted child instance id", async () => {
    const readTasks = async () => ({
      ok: true,
      data: {
        tasks: [
          { id: "task-other", status: "done" },
          {
            id: "task-child",
            status: "running",
            dispatch: { childInstanceId: "instance-42", childSessionId: "session-42" },
          },
        ],
      },
    });
    await expect(findDispatchedTaskByInstanceId(readTasks, "instance-42")).resolves.toBe(
      "task-child",
    );
    await expect(findDispatchedTaskByInstanceId(readTasks, "instance-unknown")).resolves.toBeNull();
    await expect(findDispatchedTaskByInstanceId(readTasks, "")).resolves.toBeNull();
    await expect(
      findDispatchedTaskByInstanceId(
        async () => {
          throw new Error("runtime unavailable");
        },
        "instance-42",
      ),
    ).resolves.toBeNull();
  });

  it("marks a needs-input task as answered and returns it to running", () => {
    const input = normalizeSuperAgentTasks([
      {
        id: "task-ask",
        status: "needs_input",
        title: "Clarify",
        failReason: "需要确认目标目录",
        dispatch: { childSessionId: "session-1", childInstanceId: "instance-1" },
      },
    ])[0];
    const answered = markTaskAnswered(input);
    expect(answered.status).toBe("running");
    expect(answered.failReason).toBeNull();
    expect(answered.result.status).toBe("running");
    expect(answered.events.at(-1)).toMatchObject({
      type: "answered",
      status: "running",
    });
  });

  it("normalizes legacy tasks with source, result, dispatch, and event fields", () => {
    const [task] = normalizeSuperAgentTasks([
      {
        id: "task-1",
        status: "pending",
        title: "Fix login",
        targetProject: "/repo",
      },
    ]);

    expect(task.source).toEqual({
      channel: "local",
      conversationId: null,
      userId: null,
      messageId: null,
    });
    expect(task.result).toEqual({
      status: null,
      summary: null,
      completedAt: null,
      failReason: null,
    });
    expect(task.dispatch).toEqual({
      targetProject: "/repo",
      superAgentPort: null,
      childPort: null,
      childWorkspaceId: null,
      childInstanceId: null,
      childSessionId: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(task.events).toEqual([]);
  });

  it("records dispatch metadata and an auditable status event", () => {
    const task = markTaskForDispatch(
      {
        id: "task-1",
        status: "pending",
        title: "Fix login",
        targetProject: "/repo",
      },
      { superAgentPort: 3001, childPort: 3002, now: "2026-07-10T12:00:00.000Z" },
    );

    expect(task.status).toBe("running");
    expect(task.dispatch).toMatchObject({
      targetProject: "/repo",
      superAgentPort: 3001,
      childPort: 3002,
      startedAt: "2026-07-10T12:00:00.000Z",
    });
    expect(task.events).toContainEqual({
      at: "2026-07-10T12:00:00.000Z",
      type: "dispatched",
      status: "running",
      message: "已派发给端口 3002 上的项目智能体。",
    });
  });

  it("records a structured completion result without losing source binding", () => {
    const task = markTaskFinished(
      {
        id: "task-1",
        status: "running",
        title: "Fix login",
        source: {
          channel: "telegram",
          conversationId: "chat-42",
          userId: "user-7",
          messageId: "msg-9",
        },
        dispatch: {
          targetProject: "/repo",
          superAgentPort: 3001,
          childPort: 3002,
          startedAt: "2026-07-10T12:00:00.000Z",
          finishedAt: null,
        },
      },
      {
        status: "done",
        summary: "Project agent ended. Review the child session for details.",
        now: "2026-07-10T12:05:00.000Z",
      },
    );

    expect(task.source.channel).toBe("telegram");
    expect(task.status).toBe("done");
    expect(task.result).toMatchObject({
      status: "done",
      summary: "Project agent ended. Review the child session for details.",
      completedAt: "2026-07-10T12:05:00.000Z",
      failReason: null,
    });
    expect(task.dispatch.finishedAt).toBe("2026-07-10T12:05:00.000Z");
    expect(task.events.at(-1)).toMatchObject({
      type: "completed",
      status: "done",
    });
  });

  it("pauses and resumes through an auditable fresh dispatch", () => {
    const paused = markTaskPaused(
      {
        id: "task-1",
        status: "running",
        dispatch: { childWorkspaceId: "w", childSessionId: "s", childInstanceId: "i" },
      },
      { now: "2026-07-10T12:03:00.000Z" },
    );
    expect(paused.status).toBe("paused");
    expect(paused.events.at(-1).type).toBe("paused");

    const resumed = markTaskResumed(paused, { now: "2026-07-10T12:04:00.000Z" });
    expect(resumed.status).toBe("pending");
    expect(resumed.dispatch).toMatchObject({
      childWorkspaceId: null,
      childSessionId: null,
      childInstanceId: null,
      startedAt: null,
    });
    expect(resumed.events.at(-1).type).toBe("resumed");
  });

  it("builds project and Super Agent prompts with task identity and reply routing", () => {
    const task = {
      id: "task-1",
      status: "running",
      title: "Fix login",
      description: "Investigate the failed OAuth redirect.",
      targetProject: "/repo",
      source: {
        channel: "telegram",
        conversationId: "chat-42",
        userId: "user-7",
        messageId: "msg-9",
      },
    };

    expect(buildProjectAgentPrompt(task)).toContain("Task ID: task-1");
    expect(buildProjectAgentPrompt(task)).toContain("If you need clarification");
    expect(
      buildSuperAgentNotificationPrompt(task, { status: "done", summary: "Finished" }),
    ).toContain("Reply target: telegram/chat-42");
  });

  it("builds a main-chat task prompt with the task snapshot and source binding", () => {
    expect(
      buildTaskComposerPrompt({
        id: "task-1",
        status: "pending",
        title: "Fix login",
        description: "Investigate OAuth.",
        targetProject: "/repo",
        source: { channel: "telegram", conversationId: "chat-42" },
      }),
    ).toContain("Task ID: task-1");
    expect(
      buildTaskComposerPrompt({
        id: "task-1",
        source: { channel: "telegram", conversationId: "chat-42" },
      }),
    ).toContain("Source: telegram/chat-42");
  });

  it("records a clarification request without losing the original Telegram source", () => {
    const task = markTaskNeedsInput(
      {
        id: "task-1",
        status: "pending",
        title: "Fix login",
        source: {
          channel: "telegram",
          conversationId: "chat-42",
          userId: "user-7",
          messageId: "msg-9",
        },
      },
      {
        question: "Which tenant should the agent use?",
        now: "2026-07-10T12:03:00.000Z",
      },
    );

    expect(task.status).toBe("needs_input");
    expect(task.source).toMatchObject({
      channel: "telegram",
      conversationId: "chat-42",
      userId: "user-7",
    });
    expect(task.result.failReason).toBe("Which tenant should the agent use?");
    expect(task.events.at(-1)).toEqual({
      at: "2026-07-10T12:03:00.000Z",
      type: "needs_input",
      status: "needs_input",
      message: "Which tenant should the agent use?",
    });
  });
});
