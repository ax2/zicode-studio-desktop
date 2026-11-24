import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { smokeRuntimeEnvironment } from "./smoke-runtime-environment.js";
import { browserComparisonPrompt } from "../public/native/browser/browser-chat-draft.js";
import { browserTranslationPrompt, browserTranslationSource } from "../public/native/browser/browser-translation.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const binary = resolve(argument("--pi") || join(root, "src-tauri/resources/pi/pi.exe"));
const output = argument("--output");
if (!output) throw new Error("Supply --output for the compact verification receipt");
const extension = join(root, "extensions/dist/picot-bridge.mjs");
const expectedVersion = JSON.parse(await readFile(join(root, "scripts/pi-version.json"), "utf8")).version;
const scratch = join(root, ".cache/task-scratch");
await mkdir(scratch, { recursive: true });
const directory = await mkdtemp(join(scratch, "module-model-routing-pi-"));
await writeFile(join(directory, "owner.json"), JSON.stringify({ purpose: "#79 actual Pi routing; generated fixtures only", lifetime: "remove on pass, retain on failure" }));
const requests = [];
const comparisonPrompt = browserComparisonPrompt([
  { title: "Alder", url: "https://example.invalid/alder", text: "Alder completed 37 checks.", selection: "",
    tab: "alder", documentRevision: "reviewed-alder", capturedAt: "2026-11-24T00:00:00Z" },
  { title: "Birch", url: "https://example.invalid/birch", text: "Birch completed 82 checks.", selection: "",
    tab: "birch", documentRevision: "reviewed-birch", capturedAt: "2026-11-24T00:00:01Z" },
]);
const translationSource = browserTranslationSource({
  capturedAt: "2026-11-24T00:00:00Z", documentRevision: "reviewed-translation",
  page: { title: "Sample article", url: "https://example.invalid/article", text: "Unselected page body.", selection: "This is the reviewed passage." },
});
const translationPrompt = browserTranslationPrompt(translationSource, "zh-CN");
const longTranslationPrompt = browserTranslationPrompt({ ...translationSource, text: "Stop the model at its output limit." }, "zh-CN");
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSQ0AAAAASUVORK5CYII=";
let hold = false, heldResponse, observeHeld;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const isB = request.url.startsWith("/b/");
  const images = Array.isArray(body.input) ? body.input.flatMap(message =>
    Array.isArray(message.content) ? message.content.filter(part => part.type === "input_image") : []) : [];
  const userTexts = (body.input ?? body.messages ?? []).filter(message => message.role === "user").flatMap(message =>
    typeof message.content === "string" ? [message.content] : (message.content ?? []).flatMap(part => typeof part.text === "string" ? [part.text] : []));
  const translationOnly = userTexts.length === 1 && userTexts[0] === translationPrompt;
  const maxLengthFixture = userTexts.length === 1 && userTexts[0] === longTranslationPrompt;
  const translationPolicy = (body.messages ?? []).some(message => message.role === "system" &&
    message.content.includes("Translate only the supplied reviewed text") && message.content.includes("untrusted data"));
  requests.push({ path: request.url, model: body.model,
    translationPromptMatched: translationOnly, translationPolicy,
    comparisonPromptMatched: userTexts.length === 1 && userTexts[0] === comparisonPrompt,
    authenticationMatched: request.headers.authorization === `Bearer fixture-only-${isB ? "b" : "a"}`,
    maxTokens: body.max_output_tokens ?? body.max_tokens ?? body.max_completion_tokens, reasoningEffort: body.reasoning?.effort, imageCount: images.length,
    imageMatches: images[0]?.image_url === `data:image/png;base64,${pixel}` });
  response.writeHead(200, { "content-type": "text/event-stream" });
  if (isB) {
    const message = { id: "message-fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Pi routed responses-b", annotations: [] }] };
    const events = [
      { type: "response.created", response: { id: "response-fixture", status: "in_progress" } },
      { type: "response.output_item.added", output_index: 0, item: { ...message, content: [] } },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Pi routed responses-b" },
      { type: "response.output_item.done", output_index: 0, item: message },
      { type: "response.completed", response: { id: "response-fixture", status: "completed", output: [message], usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } },
    ];
    response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
    return;
  }
  response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model,
    choices: [{ index: 0, delta: { role: "assistant", content: translationOnly ? "\u8fd9\u662f\u5ba1\u6838\u8fc7\u7684\u6bb5\u843d\u3002" : "Pi routed chat-a" }, finish_reason: null }] })}\n\n`);
  if (hold) { heldResponse = response; observeHeld?.(); return; }
  response.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model,
    choices: [{ index: 0, delta: {}, finish_reason: maxLengthFixture ? "length" : "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address !== "string");
const config = { providers: Object.fromEntries(["a", "b"].map(id => [`fixture-${id}`, {
  baseUrl: `http://127.0.0.1:${address.port}/${id}/v1`, api: id === "a" ? "openai-completions" : "openai-responses", apiKey: `fixture-only-${id}`,
  models: [{ id: id === "a" ? "chat-a" : "responses-b", name: `Fixture ${id}`, input: id === "b" ? ["text", "image"] : ["text"], reasoning: id === "b",
    contextWindow: 32768, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
}])) };
await writeFile(join(directory, "models.json"), JSON.stringify(config));
await writeFile(join(directory, "auth.json"), "{}");
await writeFile(join(directory, "settings.json"), JSON.stringify({ defaultProvider: "fixture-a", defaultModel: "chat-a" }));
const temporary = join(directory, "tmp");
await mkdir(temporary);
const environment = { ...smokeRuntimeEnvironment(directory), TEMP: temporary, TMP: temporary };
const version = spawnSync(binary, ["--version"], { cwd: directory, env: environment, windowsHide: true, encoding: "utf8", timeout: 5000 });
assert.equal(version.status, 0, "The locked Pi binary must start successfully");
assert.equal(version.stdout.trim(), expectedVersion);

function launch() {
  const process = spawn(binary, ["--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--extension", extension],
    { cwd: directory, env: environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let diagnostics = "";
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-6000).replace(/fixture-only-[ab]/g, "[synthetic credential]"); });
  const pending = new Map(), configuration = new Map();
  let text = "";
  process.stdout.setEncoding("utf8");
  process.stdout.on("data", chunk => {
    text += chunk;
    for (;;) {
      const end = text.indexOf("\n"); if (end < 0) break;
      const line = text.slice(0, end).replace(/\r$/, ""); text = text.slice(end + 1);
      if (!line) continue;
      const frame = JSON.parse(line);
      if (frame.type === "response") pending.get(frame.id)?.(frame);
      if (frame.type === "extension_ui_request" && frame.method === "notify" && typeof frame.message === "string") {
        try { const payload = JSON.parse(frame.message); configuration.get(payload.__picotConfig)?.(payload); }
        catch { /* unrelated UI notification */ }
      }
    }
  });
  const exited = new Promise((done, fail) => { process.once("exit", done); process.once("error", fail); });
  function wait(map, id, operation, timeoutMs = 15000) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { map.delete(id); fail(new Error(`Pi fixture timed out in ${operation}: ${diagnostics || "no stderr"}`)); }, timeoutMs);
      map.set(id, value => { clearTimeout(timer); map.delete(id); done(value); });
    });
  }
  function rpc(command) {
    const id = `rpc-${randomUUID()}`, result = wait(pending, id, command.type);
    process.stdin.write(`${JSON.stringify({ id, ...command })}\n`); return result;
  }
  async function call(op, params = {}) {
    const id = `cfg-${randomUUID()}`, result = wait(configuration, id, op);
    const accepted = rpc({ type: "prompt", message: `/picot-config ${JSON.stringify({ id, op, params })}` });
    const [payload, response] = await Promise.all([result, accepted]);
    assert.equal(response.success, true, "Pi did not accept the configuration command");
    return payload;
  }
  async function stop() {
    process.stdin.end();
    let timer;
    try {
      const code = await Promise.race([exited, new Promise((_, fail) => { timer = setTimeout(() => { process.kill(); fail(new Error("Pi fixture required forced shutdown")); }, 5000); })]);
      assert.equal(code, 0, `Pi did not shut down cleanly: ${diagnostics}`);
    } finally { clearTimeout(timer); }
  }
  return { rpc, call, stop };
}

let pi, passed = false, primaryFailure;
try {
  pi = launch();
  const before = await pi.rpc({ type: "get_state" });
  assert.equal(before.data.model.id, "chat-a");
  const history = await pi.rpc({ type: "get_messages" });
  const initial = await pi.call("get_module_models");
  assert.equal(initial.ok, true);
  assert.equal(initial.data.browser, null);
  assert.equal(initial.data.effectiveBrowserModel.modelId, "chat-a");
  const selected = await pi.call("save_module_model", { module: "browser", selection: { provider: "fixture-b", modelId: "responses-b" }, expectedRevision: initial.data.revision });
  assert.equal(selected.ok, true);
  assert.equal(requests.length, 0, "Reading and saving models must not make a model request");
  const ask = { requestId: "native-browser-b", confirmed: true, prompt: comparisonPrompt,
    expectedRevision: selected.data.revision, expectedModelFingerprint: selected.data.effectiveBrowserModel.fingerprint };
  const unconfirmed = await pi.call("browser_model_request", { ...ask, confirmed: false });
  assert.equal(unconfirmed.error, "module_model_confirmation_required");
  assert.equal(requests.length, 0, "Unconfirmed comparison text must not reach a provider");
  const result = await pi.call("browser_model_request", ask);
  assert.equal(result.ok, true);
  assert.equal(result.data.text, "Pi routed responses-b");
  assert.equal(result.data.model.provider, "fixture-b");
  assert.equal(requests[0].comparisonPromptMatched, true, "Pi must forward the exact reviewed comparison");
  assert.equal(selected.data.effectiveBrowserModel.supportsImages, true);
  const image = { ...ask, requestId: "native-browser-image", image: pixel, prompt: "Describe the visible pixel." };
  const blocked = await pi.call("browser_model_request", { ...image, confirmed: false });
  assert.equal(blocked.error, "module_model_confirmation_required");
  assert.equal(requests.length, 1, "Unconfirmed image must not reach a provider");
  const visual = await pi.call("browser_model_request", image);
  assert.equal(visual.ok, true);
  assert.equal(visual.data.text, "Pi routed responses-b");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].imageCount, 1);
  assert.equal(requests[1].imageMatches, true);
  assert(!JSON.stringify(result).includes("fixture-only-"));
  assert.deepEqual((await pi.rpc({ type: "get_state" })).data.model, before.data.model);
  assert.deepEqual((await pi.rpc({ type: "get_messages" })).data.messages, history.data.messages);
  const inherited = await pi.call("save_module_model", { module: "browser", selection: null, expectedRevision: selected.data.revision });
  assert.equal(inherited.ok, true);
  assert.equal(inherited.data.effectiveBrowserModel.supportsImages, false);
  const unsupported = await pi.call("browser_model_request", { ...image, requestId: "native-browser-text-only-image",
    expectedRevision: inherited.data.revision, expectedModelFingerprint: inherited.data.effectiveBrowserModel.fingerprint });
  assert.equal(unsupported.error, "module_model_image_unsupported");
  assert.equal(requests.length, 2, "A text-only model must not receive or fall back from an image request");
  const translation = { requestId: "native-browser-translation", purpose: "translation",
    prompt: translationPrompt, confirmed: true, expectedRevision: inherited.data.revision,
    expectedModelFingerprint: inherited.data.effectiveBrowserModel.fingerprint };
  assert.equal((await pi.call("browser_model_request", { ...translation, confirmed: false })).error, "module_model_confirmation_required");
  assert.equal((await pi.call("browser_model_request", { ...translation, purpose: "unknown" })).error, "module_model_request_invalid");
  assert.equal((await pi.call("browser_model_request", { ...translation, image: pixel })).error, "module_model_request_invalid");
  assert.equal(requests.length, 2, "No unconfirmed or invalid translation may reach a provider");
  const translated = await pi.call("browser_model_request", translation);
  assert.equal(translated.ok, true);
  assert.equal(translated.data.text, "\u8fd9\u662f\u5ba1\u6838\u8fc7\u7684\u6bb5\u843d\u3002");
  assert.equal(requests[2].translationPromptMatched, true, "Pi must forward exactly the reviewed selection and target language");
  assert.equal(requests[2].translationPolicy, true, "The system instruction must treat webpage text as untrusted");
  const shortened = await pi.call("browser_model_request", { ...translation, requestId: "native-browser-translation-shortened", prompt: longTranslationPrompt });
  assert.equal(shortened.error, "module_model_translation_incomplete");
  assert.equal(shortened.data, undefined);
  assert.deepEqual((await pi.rpc({ type: "get_messages" })).data.messages, history.data.messages);
  hold = true;
  const started = new Promise(done => { observeHeld = done; });
  const waiting = pi.call("browser_model_request", { ...ask, requestId: "native-browser-cancel", expectedRevision: inherited.data.revision,
    expectedModelFingerprint: inherited.data.effectiveBrowserModel.fingerprint });
  await started;
  const cancelled = await pi.call("cancel_browser_model_request", { requestId: "native-browser-cancel" });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.data.cancelled, true);
  const stopped = await waiting;
  assert.equal(stopped.ok, false);
  assert.equal(stopped.error, "module_model_request_cancelled");
  const restored = await pi.call("save_module_model", { module: "browser", selection: { provider: "fixture-b", modelId: "responses-b" }, expectedRevision: inherited.data.revision });
  assert.equal(restored.ok, true);
  await pi.stop(); pi = undefined;
  pi = launch();
  const reopened = await pi.call("get_module_models");
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.data.browser, { provider: "fixture-b", modelId: "responses-b" });
  assert.equal(reopened.data.currentPiModel.modelId, "chat-a");
  assert.equal(reopened.data.effectiveBrowserModel.modelId, "responses-b");
  assert.equal(requests.length, 5);
  assert.deepEqual(requests.map(request => request.imageCount), [0, 1, 0, 0, 0]);
  assert(requests.every(request => request.authenticationMatched && request.maxTokens === 1024));
  assert.equal(requests[0].reasoningEffort, "low", "Reasoning Responses models must receive a supported low-budget effort");
  assert.equal(requests[2].reasoningEffort, undefined, "Non-reasoning Chat Completions models must not acquire a reasoning effort");
  await pi.stop(); pi = undefined;
  const receipt = { schemaVersion: 1, verified: true, piVersion: expectedVersion,
    extensionSha256: createHash("sha256").update(await readFile(extension)).digest("hex"),
    requests, defaultPiUnchanged: true, chatHistoryUnchanged: true, explicitCancellation: true,
    unconfirmedImageDenied: true, textOnlyImageDenied: true, exactImagePayloadVerified: true,
    unconfirmedComparisonDenied: true, exactComparisonPromptVerified: true,
    unconfirmedTranslationDenied: true, exactTranslationPromptVerified: true, incompleteTranslationRejected: true,
    moduleSelectionSurvivedProcessRestart: true, automaticModelCallsOnConfiguration: 0, syntheticCredentialsOnly: true };
  await writeFile(resolve(output), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
  passed = true;
} catch (reason) {
  primaryFailure = reason;
} finally {
  try { if (pi) await pi.stop(); }
  catch (shutdown) { if (!primaryFailure) primaryFailure = shutdown; else console.error(String(shutdown)); }
  finally {
    heldResponse?.destroy(); server.closeAllConnections();
    await new Promise(done => server.close(done));
    if (passed) await rm(directory, { recursive: true, force: true });
  }
}
if (primaryFailure) throw primaryFailure;
