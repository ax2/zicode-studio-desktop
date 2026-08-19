#!/usr/bin/env node
// Regression for the session export/import round-trip: exports the workspace
// sessions through the real endpoint, verifies the backup is well-formed, and
// imports it back (existing ids must be skipped, never overwritten).
//
// Usage (app must be running on localhost):
//   node scripts/qa-session-backup.mjs <workspaceId>
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const workspaceId = process.argv[2] || process.env.ZICODE_WORKSPACE;
if (!workspaceId) {
  throw new Error("Usage: node scripts/qa-session-backup.mjs <workspaceId>");
}

async function main() {
  const exportResponse = await fetch(
    `${HOST}/v2/sessions/export?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  const exported = await exportResponse.json();
  const sessions = exported?.backup?.sessions ?? [];
  const wellFormed =
    exported?.schemaVersion === 1 &&
    Array.isArray(sessions) &&
    sessions.length > 0 &&
    sessions.every(
      (session) =>
        typeof session.sessionId === "string" &&
        session.sessionId.length > 0 &&
        typeof session.content === "string" &&
        session.content.includes('"type":"session"'),
    );

  const importResponse = await fetch(`${HOST}/v2/sessions/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, sessions }),
  });
  const imported = await importResponse.json();
  const roundTripSafe =
    importResponse.ok === true &&
    Array.isArray(imported.errors) &&
    imported.errors.length === 0 &&
    Array.isArray(imported.imported) &&
    imported.imported.length === 0 &&
    Array.isArray(imported.skipped) &&
    imported.skipped.length === sessions.length;

  const report = {
    exportOk: exportResponse.ok,
    schemaVersion: exported?.schemaVersion,
    sessionCount: sessions.length,
    sampleSession: sessions[0]?.sessionId ?? null,
    wellFormed,
    importOk: importResponse.ok,
    importedCount: (imported.imported ?? []).length,
    skippedCount: (imported.skipped ?? []).length,
    errors: imported.errors,
    roundTripSafe,
    pass: exportResponse.ok && wellFormed && roundTripSafe,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.pass ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
