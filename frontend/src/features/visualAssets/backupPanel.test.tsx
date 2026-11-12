import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BackupPanel } from "./BackupPanel";
import type { Invoke } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("starts a restore only for an empty library and refreshes once when it completes", async () => {
  const completed = { id: "restore-1", operation: "restore", state: "completed", destination: "" };
  let job: typeof completed | null = null;
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    if ((args.request as { kind: string }).kind === "startRestore") job = completed;
    return { job };
  });
  const onRestored = vi.fn();
  const props = {
    invoke,
    workspaceId: "workspace",
    disabled: false,
    onBusyChange: vi.fn(),
    onRestored,
  };
  const view = render(<BackupPanel {...props} canRestore={false} />);
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "Restore library" });
  expect(button.disabled).toBe(true);
  view.rerender(<BackupPanel {...props} canRestore />);
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByText("Visual library restored.");
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "startRestore" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh backup status" }));
  await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(4));
  expect(onRestored).toHaveBeenCalledTimes(1);
});

it("submits no path, shows a running Host task and requests cancellation by id", async () => {
  let job: { id: string; state: string; destination: string } | null = null;
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string; jobId?: string };
    if (request.kind === "startBackup")
      job = { id: "backup-1", state: "running", destination: "D:\\backups\\chosen" };
    if (request.kind === "cancelBackup" && job) job = { ...job, state: "cancelled" };
    return { job };
  });
  const busy = vi.fn();
  render(
    <BackupPanel invoke={invoke} workspaceId="workspace" disabled={false} onBusyChange={busy} />,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Back up library" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back up library" }));
  await screen.findByText("Backing up your visual library...");
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "startBackup" },
  });
  expect(busy).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel backup" }));
  await screen.findByText("Backup cancelled. Any partial files were kept.");
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "cancelBackup", jobId: "backup-1" },
  });
  expect(busy).toHaveBeenLastCalledWith(false);
});

it("reopens a durable task without resubmitting it and does not cancel on unmount", async () => {
  const invoke = vi.fn<Invoke>(async () => ({
    job: { id: "persisted", state: "publishing", destination: "D:\\backup" },
  }));
  const view = render(
    <BackupPanel invoke={invoke} workspaceId="workspace" disabled={false} onBusyChange={vi.fn()} />,
  );
  await screen.findByText("Finishing backup...");
  expect(
    (screen.getByRole("button", { name: "Cancel backup" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  view.unmount();
  expect(
    invoke.mock.calls.every(
      ([, args]) => (args.request as { kind: string }).kind === "backupStatus",
    ),
  ).toBe(true);
});

it("reviews the interrupted animation and submits only its confirmed retry token", async () => {
  const destination = "D:\\exports\\original";
  const interrupted = {
    id: "interrupted",
    operation: "animation",
    state: "interrupted",
    destination,
  };
  let job = interrupted;
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const { kind } = args.request as { kind: string };
    if (kind === "planAnimationRetry") {
      return {
        token: "retry-ticket",
        retry: {
          destination,
          intent: {
            libraryId: "library",
            format: "pngSequence",
            source: { kind: "sequence" },
            recipe: {
              looped: false,
              frames: [{ assetId: 42, revision: 2, durationMs: 245, anchorX: 3, anchorY: 4 }],
            },
          },
        },
      };
    }
    if (kind === "confirmAnimationRetry") job = { ...job, id: "retry", state: "completed" };
    return { job };
  });
  const view = render(
    <BackupPanel invoke={invoke} workspaceId="workspace" disabled={false} onBusyChange={vi.fn()} />,
  );
  const review = await screen.findByRole("button", {
    name: "Choose original folder and review retry",
  });
  expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(review);
  await screen.findByText(`Animation folder ${destination}`);
  screen.getByText("PNG frame sequence");
  screen.getByText("Image sequence · Play once");
  screen.getByText("Asset ID 42 · Revision 2 · Duration (ms) 245 · Anchor X 3 · Anchor Y 4");
  expect(invoke).toHaveBeenLastCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "planAnimationRetry", jobId: "interrupted" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(invoke).toHaveBeenLastCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "cancelAnimationRetry", token: "retry-ticket" },
  });
  const reviewAgain = screen.getByRole<HTMLButtonElement>("button", {
    name: "Choose original folder and review retry",
  });
  await waitFor(() => expect(reviewAgain.disabled).toBe(false));
  fireEvent.click(reviewAgain);
  fireEvent.click(await screen.findByRole("button", { name: "Retry animation" }));
  await screen.findByText("Animation exported.");
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "confirmAnimationRetry", token: "retry-ticket" },
  });
  view.unmount();
  expect(
    invoke.mock.calls.filter(
      ([, args]) => (args.request as { kind: string }).kind === "cancelAnimationRetry",
    ),
  ).toHaveLength(1);
});

it("keeps picker cancellation distinct from a successful backup", async () => {
  const invoke = vi.fn<Invoke>(async (_command, args) =>
    (args.request as { kind: string }).kind === "startBackup" ? { cancelled: true } : { job: null },
  );
  render(
    <BackupPanel invoke={invoke} workspaceId="workspace" disabled={false} onBusyChange={vi.fn()} />,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Back up library" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back up library" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Back up library" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByText("Visual library backup complete.")).toBeNull();
});

it("includes external originals only on explicit opt-in and reports a source failure", async () => {
  const failure = {
    id: "archive",
    state: "failed",
    phase: "copying-referenced-originals",
    destination: "D:\\backups",
  };
  let job: typeof failure | null = null;
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    if ((args.request as { kind: string }).kind === "startBackup") job = failure;
    return { job };
  });
  render(
    <BackupPanel invoke={invoke} workspaceId="workspace" disabled={false} onBusyChange={vi.fn()} />,
  );
  const choice = screen.getByRole<HTMLInputElement>("checkbox", {
    name: "Include referenced originals for offline restore",
  });
  await waitFor(() => expect(choice.disabled).toBe(false));
  expect(choice.checked).toBe(false);
  fireEvent.click(choice);
  fireEvent.click(screen.getByRole("button", { name: "Back up library" }));
  await screen.findByText(
    "Could not include a referenced original. Check its source and the backup folder.",
  );
  expect(choice.checked).toBe(false);
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "startBackup", includeReferencedOriginals: true },
  });
});
