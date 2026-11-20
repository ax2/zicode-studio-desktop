import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [probeArgument] = Bun.argv.slice(2);
assert(probeArgument, "Pass the isolated Visual Assets probe executable");
const probe = resolve(probeArgument);
const root = resolve(".cache", "task-scratch", `visual-assets-novel-drafts-${randomUUID()}`);
const profile = join(root, "profile");
const restored = join(root, "restored");
const backup = join(root, "backup");
await Promise.all([profile, restored, backup].map((path) => mkdir(path, { recursive: true })));

async function run(args, expected = 0, directory = profile, interrupt = "") {
  const child = Bun.spawn([probe, directory, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT: interrupt },
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, expected, `${args[0]}: ${stdout}${stderr}\nEvidence: ${root}`);
  return (expected === 0 ? stdout : stderr).trim();
}

async function write(name, value) {
  const file = join(root, `${name}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
}

const chapter = (body, workspaceId = "fiction-workspace") => ({
  workspaceId,
  notebookId: "manuscript",
  id: "chapter-one",
  title: "第一章 雾",
  body,
  revision: `sha256:${createHash("sha256").update(body).digest("hex")}`,
});
const first = chapter("街道空着。\r\n绘光守在桥头。\r\n河面有雾。\r\n");
const edited = chapter("街道上有风。\n绘光守在桥头。\n河面有雾。\n");
const oldChapter = await write("chapter-original", first);
const newChapter = await write("chapter-edited", edited);
const otherScope = await write("chapter-other-workspace", { ...edited, workspaceId: "different" });
const library = await run(["library-id"]);
async function character(action, directory = profile) {
  return JSON.parse(
    await run(["character-action", library, await write("character-action", action)], 0, directory),
  );
}
const { id } = await character({ kind: "create", name: "绘光", identity: "人工版本一" });
const versions = (directory) => character({ kind: "revisions", id, facet: "identity" }, directory);
const drafts = async (directory) =>
  JSON.parse(await run(["novel-list", library, id], 0, directory)).entries;
async function propose(file, text) {
  const { baseVersion, excerpts } = JSON.parse(
    await run(["novel-preview", library, id, file, "绘光"]),
  );
  assert.equal(excerpts.length, 1);
  assert.equal(excerpts[0].line, 2);
  assert.equal(excerpts[0].quote, "绘光守在桥头。");
  return {
    draftId: randomUUID(),
    characterId: id,
    facet: "identity",
    baseVersion,
    evidence: excerpts[0],
    text,
  };
}

const firstDraft = await propose(oldChapter, "守在桥头的人");
await run(["novel-save", library, await write("first-draft", firstDraft), oldChapter]);
assert.equal((await versions()).entries[0].text, "人工版本一");
assert.match(
  await run(["novel-approve", library, firstDraft.draftId, newChapter], 1),
  /visual_assets_chapter_changed/,
);
const secondDraft = await propose(newChapter, "大雾中守在桥头");
await run(["novel-save", library, await write("second-draft", secondDraft), newChapter]);
await character({ kind: "append", id, facet: "identity", previous: 1, text: "人工版本二" });
assert.match(
  await run(["novel-approve", library, secondDraft.draftId, newChapter], 1),
  /visual_assets_character_revision_changed/,
);
assert.equal((await versions()).entries[0].text, "人工版本二");

const finalDraft = await propose(newChapter, "在雾天守桥");
assert.equal(finalDraft.baseVersion, 2);
assert.notEqual(finalDraft.evidence.revision, firstDraft.evidence.revision);
const finalFile = await write("final-draft", finalDraft);
const forged = await write("forged", {
  ...finalDraft,
  evidence: { ...finalDraft.evidence, line: 1 },
});
assert.match(
  await run(["novel-save", library, forged, newChapter], 1),
  /visual_assets_chapter_changed/,
);
assert.match(
  await run(["novel-save", library, finalFile, otherScope], 1),
  /visual_assets_chapter_changed/,
);
assert.match(
  await run(["novel-save", randomUUID(), finalFile, newChapter], 1),
  /visual_assets_library_changed/,
);
await run(["novel-save", library, finalFile, newChapter]);
await run(["novel-save", library, finalFile, newChapter]);
assert.equal((await drafts()).length, 3);
const approval = ["novel-approve", library, finalDraft.draftId, newChapter];
await run(approval, 86, profile, "novel-draft-before-commit");
assert.equal((await versions()).entries[0].version, 2);
assert.equal((await drafts()).find((item) => item.id === finalDraft.draftId).approvedVersion, null);
await run(approval, 86, profile, "novel-draft-committed");
assert.deepEqual(
  JSON.parse(await run(["novel-approve", library, finalDraft.draftId, oldChapter])),
  { version: 3 },
);
const approved = (await versions()).entries[0];
assert.deepEqual(approved, { version: 3, text: finalDraft.text, manuscript: finalDraft.evidence });

const snapshot = await run(["backup", backup]);
assert.equal(JSON.parse(await readFile(join(snapshot, "manifest.json"), "utf8")).version, 8);
await run(["restore", snapshot], 0, restored);
assert.deepEqual((await versions(restored)).entries[0], approved);
const history = await drafts(restored);
assert.equal(
  history.find((draft) => draft.id === firstDraft.draftId).evidence.revision,
  first.revision,
);
assert.equal(history.find((draft) => draft.id === secondDraft.draftId).approvedVersion, null);
assert.equal(history.find((draft) => draft.id === finalDraft.draftId).approvedVersion, 3);
const receipt = {
  run: root,
  previousChapterRevision: first.revision,
  approved,
  snapshotVersion: 8,
  rejectedStaleChapterAndCharacter: true,
  approvalInterruptedBeforeAndAfterCommit: true,
};
await write("receipt", receipt);
console.log(JSON.stringify(receipt, null, 2));
