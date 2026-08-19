#!/usr/bin/env node
// Web capture regression: fetches a stable public page through the real
// notes capture endpoint and verifies the resulting note keeps the title,
// Markdown body, web-clip tag and source URL. Cleans up the note afterwards.
//
// Usage (app must be running on localhost):
//   node scripts/qa-web-capture.mjs <workspaceId>
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const workspaceId = process.argv[2] || process.env.ZICODE_WORKSPACE;
if (!workspaceId) {
  throw new Error("Usage: node scripts/qa-web-capture.mjs <workspaceId>");
}

async function main() {
  const scene = "programming";
  const notebookResponse = await fetch(`${HOST}/v2/notes/notebooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      sceneId: scene,
      title: "__qa_capture__",
      icon: "🌐",
    }),
  });
  if (!notebookResponse.ok) {
    throw new Error(`create notebook failed: ${notebookResponse.status}`);
  }
  const notebook = (await notebookResponse.json()).notebook;

  let note = null;
  let captureOk = false;
  try {
    const captureResponse = await fetch(`${HOST}/v2/notes/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        sceneId: scene,
        notebookId: notebook.id,
        url: "https://example.com",
      }),
    });
    const body = await captureResponse.json();
    note = body.note;
    captureOk =
      captureResponse.ok === true &&
      body.duplicate === false &&
      note?.title === "Example Domain" &&
      (note.content ?? "").includes("Example Domain") &&
      Array.isArray(note.tags) &&
      note.tags.includes("web-clip") &&
      (note.source?.url ?? "").includes("example.com");
  } finally {
    if (note?.id && note?.notebookId) {
      await fetch(`${HOST}/v2/notes/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          sceneId: scene,
          notebookId: note.notebookId,
          noteId: note.id,
          expectedVersion: note.version ?? "",
        }),
      });
    }
    await fetch(`${HOST}/v2/notes/notebooks/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        sceneId: scene,
        notebookId: notebook.id,
      }),
    });
  }

  const report = {
    captureOk,
    title: note?.title ?? null,
    hasBody: note ? note.content.includes("Example Domain") : false,
    tags: note?.tags ?? [],
    sourceUrl: note?.source?.url ?? null,
    pass: captureOk,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.pass ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
