// Functional smoke test for the application-plugin write paths.
//
// Run against a live ZiCode Studio Desktop instance (the desktop app must be
// running). Every test performs a create → read-back → delete round trip and
// cleans up after itself, so it does not leave data behind in the workspace.
//
// Usage:
//   bun run scripts/smoke-plugin-writes.js <workspaceId>
//   ZICODE_HOST=http://127.0.0.1:57620 bun run scripts/smoke-plugin-writes.js <workspaceId>

const workspaceId = process.argv[2] || process.env.ZICODE_WORKSPACE;
if (!workspaceId) {
  console.error("Usage: bun run scripts/smoke-plugin-writes.js <workspaceId>");
  process.exit(2);
}

const base = (process.env.ZICODE_HOST || "http://127.0.0.1:57620").replace(/\/+$/, "");
const sceneId = "programming";

async function json(path, options) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const parsed = await response.json();
      detail = parsed?.error?.message || parsed?.error?.code || "";
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(`${path} failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

function scope() {
  return { workspaceId, sceneId };
}

async function roundTrip(label, create, verify, remove) {
  const created = await create();
  const ok = await verify(created);
  if (!ok) throw new Error(`${label}: created item did not read back`);
  await remove(created);
  console.log(`ok  ${label}`);
}

async function main() {
  // Habits
  await roundTrip(
    "habits upsert/remove",
    async () => {
      const { habit } = await json("/v2/habits/upsert", {
        method: "POST",
        body: JSON.stringify({
          ...scope(),
          name: "__qa_habit__",
          emoji: "🧪",
          color: "#4f46e5",
        }),
      });
      return habit;
    },
    async (habit) => {
      const list = await json(
        `/v2/habits?sceneId=${encodeURIComponent(sceneId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      return list.habits.some((entry) => entry.id === habit.id);
    },
    async (habit) =>
      json("/v2/habits/remove", {
        method: "POST",
        body: JSON.stringify({ ...scope(), habitId: habit.id }),
      }),
  );

  // Clipboard
  await roundTrip(
    "clipboard add/remove",
    async () => {
      const { item } = await json("/v2/clipboard/add", {
        method: "POST",
        body: JSON.stringify({ ...scope(), text: "__qa_clipboard__", source: "qa" }),
      });
      return item;
    },
    async (item) => {
      const list = await json(
        `/v2/clipboard?sceneId=${encodeURIComponent(sceneId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      return list.items.some((entry) => entry.id === item.id);
    },
    async (item) =>
      json("/v2/clipboard/remove", {
        method: "POST",
        body: JSON.stringify({ ...scope(), id: item.id }),
      }),
  );

  // Web watch
  await roundTrip(
    "watch add/remove",
    async () => {
      const { item } = await json("/v2/watch/add", {
        method: "POST",
        body: JSON.stringify({
          ...scope(),
          name: "__qa_watch__",
          url: "https://example.com/qa-watch",
        }),
      });
      return item;
    },
    async (item) => {
      const list = await json(
        `/v2/watch?sceneId=${encodeURIComponent(sceneId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      return list.items.some((entry) => entry.id === item.id);
    },
    async (item) =>
      json("/v2/watch/remove", {
        method: "POST",
        body: JSON.stringify({ ...scope(), id: item.id }),
      }),
  );

  // Notes (requires an existing notebook; the notes smoke path is skipped when
  // the workspace has none rather than creating extra notebooks).
  const snapshot = await json(
    `/v2/notes?sceneId=${encodeURIComponent(sceneId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  const notebookId = snapshot?.snapshot?.notebooks?.[0]?.id;
  if (!notebookId) {
    console.log("skip notes (no notebook in workspace)");
  } else {
    await roundTrip(
      "notes create/delete/purge",
      async () => {
        const { note } = await json("/v2/notes/create", {
          method: "POST",
          body: JSON.stringify({
            ...scope(),
            notebookId,
            title: "__qa_note__",
            content: "qa body",
          }),
        });
        return note;
      },
      async (note) => {
        const after = await json(
          `/v2/notes?sceneId=${encodeURIComponent(sceneId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
        );
        return after.snapshot.notes.some((entry) => entry.id === note.id);
      },
      async (note) => {
        await json("/v2/notes/delete", {
          method: "POST",
          body: JSON.stringify({
            ...scope(),
            notebookId,
            noteId: note.id,
            expectedVersion: note.version,
          }),
        });
        await json("/v2/notes/trash/purge", {
          method: "POST",
          body: JSON.stringify({ ...scope(), notebookId, noteId: note.id }),
        });
      },
    );
  }

  console.log("plugin write smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
