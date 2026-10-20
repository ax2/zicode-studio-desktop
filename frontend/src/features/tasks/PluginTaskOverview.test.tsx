import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginTaskOverview } from "./PluginTaskOverview";

afterEach(cleanup);

it("shows only the current workspace and loads later pages on demand", async () => {
  const list = vi.fn(async (workspaceId: string, before?: { taskRef: string }) => {
    if (workspaceId === "workspace-b") return { tasks: [], nextCursor: null };
    return before
      ? {
          tasks: [
            {
              taskRef: "second",
              pluginId: "example.tools",
              operationId: "convert",
              state: "succeeded",
              packageVersion: "1.0.0",
              updatedAtMs: 2,
            },
          ],
          nextCursor: null,
        }
      : {
          tasks: [
            {
              taskRef: "first",
              pluginId: "example.tools",
              operationId: "inspect",
              state: "running",
              packageVersion: "1.0.0",
              updatedAtMs: 1,
            },
          ],
          nextCursor: { taskRef: "first", updatedAtMs: 1 },
        };
  });
  const view = render(<PluginTaskOverview workspaceId="workspace-a" list={list} />);
  await waitFor(() => expect(screen.getByText("inspect")).toBeTruthy());
  expect(screen.getByText(/运行中/)).toBeTruthy();
  fireEvent.click(screen.getByText("加载更多"));
  await waitFor(() => expect(screen.getByText("convert")).toBeTruthy());
  expect(list).toHaveBeenCalledWith("workspace-a", { taskRef: "first", updatedAtMs: 1 });

  view.rerender(<PluginTaskOverview workspaceId="workspace-b" list={list} />);
  await waitFor(() => expect(screen.getByText("当前工作区暂无插件任务")).toBeTruthy());
  expect(screen.queryByText("inspect")).toBeNull();
  expect(screen.queryByText("convert")).toBeNull();
});

it("keeps plugin task read failures within the plugin section", async () => {
  render(
    <PluginTaskOverview
      workspaceId="workspace-a"
      list={async () => {
        throw new Error("secret server details");
      }}
    />,
  );
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("无法加载插件任务"));
  expect(screen.queryByText("secret server details")).toBeNull();
});

it("loads bounded task history on demand and isolates a detail failure", async () => {
  const list = vi.fn(async () => ({ tasks: [{ taskRef: "task-a", pluginId: "example.tools",
    operationId: "inspect", state: "running", packageVersion: "1.0.0", updatedAtMs: 1 }],
    nextCursor: null }));
  const detail = vi.fn(async (_workspaceId: string, taskRef: string) => {
    if (taskRef !== "task-a") throw new Error("wrong task");
    return { snapshot: { taskRef, state: "running", latestSequence: 2,
      cancelRequested: true },
      events: [{ sequence: 1, state: "queued", atMs: 1 },
        { sequence: 2, state: "running", atMs: 2 }],
      earlierEventsAvailable: false };
  });
  render(<PluginTaskOverview workspaceId="workspace-a" list={list} detail={detail} />);
  await waitFor(() => expect(screen.getByText("inspect")).toBeTruthy());
  fireEvent.click(screen.getByText("查看任务详情"));
  await waitFor(() => expect(screen.getByText(/已请求取消/)).toBeTruthy());
  expect(screen.getByText(/排队中/)).toBeTruthy();
  expect(detail).toHaveBeenCalledWith("workspace-a", "task-a");
  fireEvent.click(screen.getByText("收起任务详情"));
  expect(screen.queryByText(/已请求取消/)).toBeNull();
});

it("pages earlier events without losing the recent task history", async () => {
  const list = async () => ({ tasks: [{ taskRef: "task-a", pluginId: "example.tools",
    operationId: "inspect", state: "running", packageVersion: "1.0.0", updatedAtMs: 1 }],
    nextCursor: null });
  const detail = vi.fn(async (_workspaceId: string, taskRef: string, beforeSequence?: number) => ({
    snapshot: { taskRef, state: "running", latestSequence: 66, cancelRequested: false },
    events: beforeSequence === undefined
      ? Array.from({ length: 64 }, (_, index) => ({ sequence: index + 3, state: "running", atMs: index + 3 }))
      : [{ sequence: 1, state: "queued", atMs: 1 }, { sequence: 2, state: "running", atMs: 2 }],
    earlierEventsAvailable: beforeSequence === undefined,
  }));
  render(<PluginTaskOverview workspaceId="workspace-a" list={list} detail={detail} />);
  await waitFor(() => expect(screen.getByText("inspect")).toBeTruthy());
  fireEvent.click(screen.getByText("查看任务详情"));
  await waitFor(() => expect(screen.getByText("加载更早的任务事件")).toBeTruthy());
  fireEvent.click(screen.getByText("加载更早的任务事件"));
  await waitFor(() => expect(screen.getByText(/排队中/)).toBeTruthy());
  expect(document.querySelector(".ui-panel ol")?.getAttribute("start")).toBe("1");
  expect(screen.getAllByText(/运行中/).length).toBeGreaterThan(1);
  expect(screen.queryByText("加载更早的任务事件")).toBeNull();
  expect(detail).toHaveBeenNthCalledWith(2, "workspace-a", "task-a", 3);
});
