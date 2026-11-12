import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [probeArgument, sampleArgument] = Bun.argv.slice(2);
assert(probeArgument && sampleArgument, "Pass the probe executable and a sample PNG");
const probe = resolve(probeArgument);
const sample = resolve(sampleArgument);
const root = resolve(".cache", "task-scratch", `visual-assets-comfyui-${randomUUID()}`);
const profile = join(root, "profile");
const restored = join(root, "restored");
const backup = join(root, "backup");
const archiveBackup = join(root, "archive-backup");
const archiveRestore = join(root, "archive-restored");
const preparingBackup = join(root, "preparing-backup");
const preparingRestore = join(root, "preparing-restored");
await Promise.all(
  [profile, restored, backup, archiveBackup, archiveRestore, preparingBackup, preparingRestore].map(
    (path) => mkdir(path, { recursive: true }),
  ),
);

const checkpoint = "fixture.safetensors";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalHash = hash(await readFile(sample));
const generated = await readFile(resolve("public/icons/app-512.png"));
let resultBytes = generated;
let outputOffline = false;
let viewCount = 0;
let promptId = randomUUID();
const uploads = [];
let postCount = 0;
let rejectPrompt = false;
let queue = false;
let completed = false;
let prompt;
let returnReceipt = false;
let uploadGate;
let statusReads = 0;
let timing = "wrong-prompt";
const startMs = 1794400000000;
const endMs = startMs + 321;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.startsWith("/object_info/")) {
      const name = url.pathname.split("/").pop();
      return Response.json({ [name]: { input: { required: { ckpt_name: [[checkpoint], {}] } } } });
    }
    if (request.method === "POST" && url.pathname === "/upload/image") {
      const form = await request.formData();
      const image = form.get("image");
      assert(image instanceof File);
      assert.equal(form.get("type"), "input");
      assert.equal(form.get("subfolder"), "zicode");
      assert.equal(form.has("overwrite"), false);
      uploads.push({ name: image.name, sha256: hash(Buffer.from(await image.arrayBuffer())) });
      if (uploadGate) {
        uploadGate.arrived.resolve();
        await uploadGate.release.promise;
      }
      return Response.json({ name: image.name, type: "input", subfolder: "zicode" });
    }
    if (request.method === "POST" && url.pathname === "/prompt") {
      postCount += 1;
      if (rejectPrompt)
        return Response.json(
          { error: { type: "fixture_rejection" }, node_errors: {} },
          { status: 400 },
        );
      const submitted = await request.json();
      prompt = [1, promptId, submitted.prompt, submitted.extra_data, []];
      assert.equal(submitted.client_id, submitted.extra_data.zicode_attempt);
      assert(
        Object.values(submitted.prompt).some(
          (node) =>
            node.class_type === "LoadImage" &&
            node.inputs.image === `zicode/${uploads.at(-1).name}`,
        ),
      );
      assert(
        Object.values(submitted.prompt).some(
          (node) => node.class_type === "CLIPTextEncode" && node.inputs.text === "点灯人\n夜景",
        ),
      );
      return returnReceipt
        ? Response.json({ prompt_id: promptId })
        : new Response("Response unavailable", { status: 502 });
    }
    if (request.method === "GET" && url.pathname === "/queue") {
      statusReads += 1;
      return Response.json({ queue_running: [], queue_pending: queue ? [prompt] : [] });
    }
    if (request.method === "GET" && url.pathname.startsWith("/history")) {
      statusReads += 1;
      if (!completed) return Response.json({});
      const id = prompt[3].zicode_attempt;
      const interrupted = timing === "interrupted";
      const messages = [
        ["execution_start", { prompt_id: promptId, timestamp: startMs }],
        ["execution_cached", { prompt_id: promptId, timestamp: startMs + 2 }],
        [
          interrupted ? "execution_interrupted" : "execution_success",
          {
            prompt_id: timing === "wrong-prompt" ? randomUUID() : promptId,
            timestamp: timing === "reversed" ? startMs - 1 : endMs,
          },
        ],
      ];
      return Response.json({
        [promptId]: {
          prompt,
          status: {
            status_str: interrupted ? "error" : "success",
            completed: !interrupted,
            messages,
          },
          outputs: {
            9: {
              images: [
                { filename: `${id}_00001_.png`, subfolder: "zicode", type: "output" },
                { filename: "other.png", subfolder: "elsewhere", type: "output" },
              ],
            },
          },
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/view") {
      viewCount += 1;
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        filename: `${prompt[3].zicode_attempt}_00001_.png`,
        subfolder: "zicode",
        type: "output",
      });
      if (outputOffline) return new Response("Offline", { status: 503 });
      return new Response(resultBytes, { headers: { "Content-Type": "image/png" } });
    }
    return new Response("Unexpected fixture route", { status: 404 });
  },
});

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
  return expected === 0 ? stdout.trim() : stderr.trim();
}

try {
  const library = await run(["library-id"]);
  const asset = Number(await run(["import", sample]));
  const actionFile = join(root, "action.json");
  async function action(value) {
    await writeFile(actionFile, JSON.stringify(value));
    return JSON.parse(await run(["character-action", library, actionFile]));
  }
  const { id: characterId } = await action({ kind: "create", name: "灯", identity: "点灯人" });
  const { id: referenceSetId } = await action({
    kind: "approveReferences",
    id: characterId,
    requestId: randomUUID(),
    name: "已批准",
    references: [{ assetId: asset, revision: 1 }],
  });
  const { id: recipeId } = await action({
    kind: "createRecipe",
    id: characterId,
    name: "夜景",
    draft: {
      identityVersion: 1,
      referenceSetId,
      prompt: "夜景",
      settingsJson: `{ "checkpoint": "${checkpoint}", "seed": 9223372036854775807 }`,
    },
  });
  const selection = join(root, "selection.json");
  await writeFile(selection, JSON.stringify({ characterId, recipeId, version: 1 }));
  const port = String(server.port);
  const { plan } = JSON.parse(await run(["comfy-plan", selection, port]));
  assert.equal(plan.inputs.settings.seed, "9223372036854775807");
  assert.equal(plan.inputs.references[0].sha256, originalHash);
  assert.deepEqual(plan.budget, { providerFeeLimit: 0 });
  assert.equal(postCount, 0);
  assert.equal(uploads.length, 0);
  assert.deepEqual(JSON.parse(await run(["comfy-list", library, selection])).attempts, []);
  const generate = ["comfy-run", selection, port];
  const list = ["comfy-list", library, selection];
  const findAttempt = async (predicate, directory = profile) =>
    JSON.parse(await run(list, 0, directory)).attempts.find(predicate);
  await run(generate, 86, profile, "comfy-before-upload");
  assert.equal(uploads.length, 0);
  const pendingSnapshot = await run(["backup", preparingBackup]);
  await run(["restore", pendingSnapshot], 0, preparingRestore);
  const interrupted = await findAttempt((item) => item.interruptedBeforeSubmit);
  assert.equal(interrupted.state, "upload_failed");
  const restoredPending = await findAttempt((item) => item.id === interrupted.id, preparingRestore);
  assert.equal(restoredPending.state, "unknown");
  assert.equal(restoredPending.interruptedBeforeSubmit, false);
  await run(generate, 1, preparingRestore);
  assert.equal(postCount, 0);

  uploadGate = { arrived: Promise.withResolvers(), release: Promise.withResolvers() };
  const activeUpload = run(generate, 86, profile, "comfy-reference-uploaded");
  let uploading;
  try {
    await Promise.race([
      uploadGate.arrived.promise,
      activeUpload.then(() => assert.fail("upload gate was missed")),
    ]);
    uploading = await findAttempt((item) => item.state === "submitting");
    assert(uploading, "a separate process must see the attempt still being prepared");
    assert.equal(
      JSON.parse(await run(["comfy-refresh", library, uploading.id])).attempt.state,
      "submitting",
    );
    assert.match(await run(generate, 1), /visual_assets_comfy_dispatch_busy/);
    assert.equal(statusReads, 0);
    assert.equal(postCount, 0);
  } finally {
    uploadGate.release.resolve();
    uploadGate = undefined;
    await activeUpload;
  }
  assert.equal(
    (await findAttempt((item) => item.id === uploading.id)).interruptedBeforeSubmit,
    true,
  );
  assert.equal(uploads.length, 1);
  assert.equal(postCount, 0);
  uploads.length = 0;

  const { attempt } = JSON.parse(await run(["comfy-run", selection, port]));
  assert.equal(attempt.state, "unknown");
  assert.equal(attempt.promptId, null);
  assert.equal(attempt.providerFee, 0);
  assert.equal(attempt.executionUsage, null);
  assert.equal(uploads[0].sha256, originalHash);
  assert.match(await run(["comfy-run", selection, port], 1), /visual_assets_comfy_attempt_active/);
  assert.equal(postCount, 1);
  assert.equal(uploads.length, 1);
  assert.equal(
    JSON.parse(await run(["comfy-refresh", library, attempt.id])).attempt.state,
    "unknown",
  );
  queue = true;
  const queued = JSON.parse(await run(["comfy-refresh", library, attempt.id])).attempt;
  assert.equal(queued.state, "queued");
  assert.equal(queued.promptId, promptId);
  completed = true;
  const refresh = ["comfy-refresh", library, attempt.id];
  const firstReady = JSON.parse(await run(refresh)).attempt;
  assert.equal(firstReady.state, "ready");
  assert.equal(firstReady.executionUsage, null);
  timing = "reversed";
  assert.equal(JSON.parse(await run(refresh)).attempt.executionUsage, null);
  timing = "valid";
  const ready = JSON.parse(await run(refresh)).attempt;
  assert.equal(ready.state, "ready");
  assert.equal(ready.providerFee, 0);
  assert.deepEqual(ready.executionUsage, {
    startedAtMs: startMs,
    finishedAtMs: endMs,
    outcome: "success",
  });
  assert.deepEqual(ready.outputs, [{ filename: `${attempt.id}_00001_.png`, subfolder: "zicode" }]);
  const readsAtSettlement = statusReads;
  assert.deepEqual(JSON.parse(await run(refresh)).attempt.executionUsage, ready.executionUsage);
  assert.equal(statusReads, readsAtSettlement);
  assert.equal(postCount, 1);

  rejectPrompt = true;
  assert.equal(JSON.parse(await run(["comfy-run", selection, port])).attempt.state, "rejected");
  const snapshot = await run(["backup", backup]);
  assert.equal(JSON.parse(await readFile(join(snapshot, "manifest.json"), "utf8")).version, 6);
  await run(["restore", snapshot], 0, restored);
  const listed = JSON.parse(await run(["comfy-list", library, selection], 0, restored));
  const restoredReady = listed.attempts.find((entry) => entry.id === ready.id);
  assert.equal(restoredReady.state, "ready");
  assert.deepEqual(restoredReady.executionUsage, ready.executionUsage);
  assert.equal(restoredReady.providerFee, 0);
  assert.equal(postCount, 2);

  const filename = ready.outputs[0].filename;
  const reviewArgs = ["comfy-review", library, ready.id, filename];
  const archiveArgs = ["comfy-archive", library, ready.id, filename, hash(generated)];
  const assetCount = async () => JSON.parse(await run(["list"])).assets.length;
  assert.equal(await assetCount(), 1);
  await run(["comfy-review", randomUUID(), ready.id, filename], 1);
  await run(["comfy-review", library, ready.id, "other.png"], 1);
  assert.equal(viewCount, 0);
  resultBytes = generated.subarray(0, 8);
  await run(reviewArgs, 1);
  assert(
    !(await readdir(join(profile, "visual-assets"))).some((name) =>
      name.startsWith("pending.comfy-review"),
    ),
  );
  resultBytes = generated;
  const review = JSON.parse(await run(reviewArgs));
  assert.equal(review.sha256, hash(generated));
  assert(Buffer.from(review.base64, "base64").subarray(0, 8).equals(generated.subarray(0, 8)));
  assert.equal(await assetCount(), 1);
  resultBytes = await readFile(sample);
  assert.match(await run(archiveArgs, 1), /visual_assets_comfy_output_changed/);
  assert.equal(await assetCount(), 1);
  resultBytes = generated;
  await run(archiveArgs, 86, profile, "published");
  assert.equal(await assetCount(), 1);
  await run(archiveArgs, 86, profile, "comfy-output-committed");
  const viewsBeforeRetry = viewCount;
  outputOffline = true;
  const { archived } = JSON.parse(await run(archiveArgs));
  assert.equal(viewCount, viewsBeforeRetry);
  assert.equal(archived.sha256, review.sha256);
  assert.equal(await assetCount(), 2);
  const archiveSnapshot = await run(["backup", archiveBackup]);
  assert.equal(
    JSON.parse(await readFile(join(archiveSnapshot, "manifest.json"), "utf8")).version,
    7,
  );
  await run(["restore", archiveSnapshot], 0, archiveRestore);
  const archivedAttempt = JSON.parse(
    await run(["comfy-list", library, selection], 0, archiveRestore),
  ).attempts.find((entry) => entry.id === ready.id);
  assert.deepEqual(archivedAttempt.archived, [archived]);
  assert.deepEqual(archivedAttempt.executionUsage, ready.executionUsage);
  const restoredAsset = JSON.parse(await run(["list"], 0, archiveRestore)).assets.find(
    (entry) => entry.id === archived.assetId,
  );
  assert.deepEqual(restoredAsset.generatedFrom, {
    attemptId: ready.id,
    recipeName: "夜景",
    recipeVersion: 1,
  });
  assert.equal(
    hash(await readFile(join(archiveRestore, "visual-assets", `${archived.sha256}.blob`))),
    archived.sha256,
  );
  assert.equal(viewCount, viewsBeforeRetry);
  assert.equal(postCount, 2);
  rejectPrompt = false;
  queue = false;
  completed = false;
  returnReceipt = true;
  const acceptedPrompt = randomUUID();
  promptId = acceptedPrompt;
  await run(generate, 86, profile, "comfy-prompt-returned");
  assert.equal(postCount, 3);
  const unrecorded = await findAttempt((item) => item.state === "unknown");
  assert.equal(unrecorded.promptId, null);
  assert.match(await run(generate, 1), /visual_assets_comfy_attempt_active/);
  assert.equal(postCount, 3);
  queue = true;
  const recovered = JSON.parse(await run(["comfy-refresh", library, unrecorded.id])).attempt;
  assert.equal(recovered.promptId, acceptedPrompt);
  assert.equal(recovered.state, "queued");
  completed = true;
  timing = "interrupted";
  const failed = JSON.parse(await run(["comfy-refresh", library, unrecorded.id])).attempt;
  assert.equal(failed.state, "failed");
  assert.equal(failed.providerFee, 0);
  assert.deepEqual(failed.executionUsage, {
    startedAtMs: startMs,
    finishedAtMs: endMs,
    outcome: "interrupted",
  });
  await run(generate, 86, profile, "comfy-before-prompt");
  const boundary = await findAttempt((item) => item.state === "unknown");
  assert.equal(boundary.interruptedBeforeSubmit, false);
  assert.equal(boundary.promptId, null);
  assert.match(await run(generate, 1), /visual_assets_comfy_attempt_active/);
  assert.equal(postCount, 3);

  const receipt = {
    run: root,
    originalHash,
    submittedExactlyOnceBeforeRecovery: true,
    promptId: ready.promptId,
    acceptedPromptAfterProcessExit: recovered.promptId,
    interruptedBeforeFirstUpload: interrupted.id,
    interruptedAfterReferenceUpload: uploading.id,
    restoredPreSubmitState: restoredPending.state,
    uncertaintyBoundaryAttempt: boundary.id,
    restoredAttempt: ready,
    snapshotVersion: 6,
    archiveSnapshotVersion: 7,
    archived,
    rejectedChangedAndUnlistedOutputs: true,
    recoveredBeforeAndAfterArchiveCommit: true,
    rejectedMismatchedAndReversedTiming: true,
    interruptedExecutionUsage: failed.executionUsage,
  };
  await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await server.stop(true);
}
