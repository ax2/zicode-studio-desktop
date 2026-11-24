// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ModuleModelStore, moduleModelOperation } from "./module-model-routing";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const root = () => { const value = mkdtempSync(join(tmpdir(), "module-routing-")); roots.push(value); return value; };

it("persists only module references, checks revisions and preserves unreadable configuration", () => {
  const file = join(root(), "routes.json");
  const store = new ModuleModelStore(file);
  const initial = store.read();
  expect(initial.document).toEqual({ schemaVersion: 1, browser: null });
  store.save(initial.revision, { provider: "fixture-a", modelId: "a" });
  expect(new ModuleModelStore(file).read().document.browser).toEqual({ provider: "fixture-a", modelId: "a" });
  expect(() => store.save(initial.revision, null)).toThrow("module_model_config_changed");
  const unknown = '{"schemaVersion":2,"browser":null,"future":true}';
  writeFileSync(file, unknown);
  expect(() => store.read()).toThrow("module_model_config_unavailable");
  expect(() => store.save(initial.revision, null)).toThrow();
  expect(readFileSync(file, "utf8")).toBe(unknown);
});

it("routes through real Pi registry authentication with module override, inheritance, disable and cancellation", async () => {
  const directory = root();
  const requests: Array<{ url: string; model: string; authorization: string; limit: number; effort?: string }> = [];
  const imageRequests: unknown[] = [];
  let hold = false;
  let held: ServerResponse | undefined;
  let observed: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ url: request.url ?? "", model: body.model, authorization: request.headers.authorization ?? "", limit: body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens, effort: body.reasoning?.effort });
    if (Array.isArray(body.input)) {
      imageRequests.push(...body.input.flatMap((message: { content?: unknown[] }) =>
        Array.isArray(message.content) ? message.content.filter(part => (part as { type?: string }).type === "input_image") : []));
    }
    if (JSON.stringify(body).includes("fixture-reject")) {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "untrusted fixture-only-a detail", type: "rate_limit_error" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (request.url?.includes("/b/")) {
      const message = { id: "message-fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "routed:b", annotations: [] }] };
      const events = [
        { type: "response.created", response: { id: "response-fixture", status: "in_progress" } },
        { type: "response.output_item.added", output_index: 0, item: { ...message, content: [] } },
        { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "routed:b" },
        { type: "response.output_item.done", output_index: 0, item: message },
        { type: "response.completed", response: { id: "response-fixture", status: "completed", output: [message], usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } },
      ];
      response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
      return;
    }
    response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model,
      choices: [{ index: 0, delta: { role: "assistant", content: `routed:${body.model}` }, finish_reason: null }] })}\n\n`);
    if (hold) { held = response; observed?.(); return; }
    response.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server unavailable");
  const modelsPath = join(directory, "models.json"), authPath = join(directory, "auth.json");
  writeFileSync(authPath, "{}");
  writeFileSync(modelsPath, JSON.stringify({ providers: Object.fromEntries(["a", "b"].map(id => [`fixture-${id}`, {
    baseUrl: `http://127.0.0.1:${address.port}/${id}/v1`, api: id === "a" ? "openai-completions" : "openai-responses", apiKey: `fixture-only-${id}`,
    models: [{ id, name: `Model ${id}`, reasoning: id === "b", input: id === "b" ? ["text", "image"] : ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 2048 }],
  }])) }));
  try {
    const runtime = await ModelRuntime.create({ modelsPath, authPath, allowModelNetwork: false });
    const registry = new ModelRegistry(runtime);
    const current = registry.find("fixture-a", "a");
    expect(current).toBeTruthy();
    const store = new ModuleModelStore(join(directory, "routes.json"));
    const disabled = new Set<string>();
    const call = (op: string, params: Record<string, unknown> = {}) => moduleModelOperation(op, params,
      { modelRegistry: registry, model: current }, store, provider => provider.startsWith("fixture-") && !disabled.has(provider)) as Promise<any>;
    const initial = await call("get_module_models");
    expect(initial.models.map((model: any) => [model.provider, model.modelId])).toEqual([["fixture-a", "a"], ["fixture-b", "b"]]);
    expect(initial.effectiveBrowserModel.modelId).toBe("a");
    const overridden = await call("save_module_model", { module: "browser", selection: { provider: "fixture-b", modelId: "b" }, expectedRevision: initial.revision });
    expect(requests).toHaveLength(0);
    const request = { requestId: "fixture-request-b", confirmed: true, prompt: 'Question about captured source https://example.org/source. {"sourceTrust":"untrusted-web-content","text":"fixture"}',
      expectedRevision: overridden.revision, expectedModelFingerprint: overridden.effectiveBrowserModel.fingerprint };
    await expect(call("browser_model_request", { ...request, confirmed: false })).rejects.toThrow("module_model_confirmation_required");
    await expect(call("browser_model_request", { ...request, expectedModelFingerprint: "stale" })).rejects.toThrow("module_model_config_changed");
    expect(requests).toHaveLength(0);
    const response = await call("browser_model_request", request);
    expect(response.text).toBe("routed:b");
    expect(response.model.provider).toBe("fixture-b");
    expect(response.inherited).toBe(false);
    expect(JSON.stringify(response)).not.toContain("fixture-only-");
    expect(requests[0]).toEqual({ url: "/b/v1/responses", model: "b", authorization: "Bearer fixture-only-b", limit: 1024, effort: "low" });
    expect(current?.id).toBe("a");
    disabled.add("fixture-b");
    const unavailable = await call("get_module_models");
    expect(unavailable.effectiveBrowserModel).toBeNull();
    await expect(call("browser_model_request", request)).rejects.toThrow("module_model_selection_unavailable");
    expect(requests).toHaveLength(1);
    const inherited = await call("save_module_model", { module: "browser", selection: null, expectedRevision: unavailable.revision });
    expect(inherited.effectiveBrowserModel.modelId).toBe("a");
    const result = await call("browser_model_request", { ...request, requestId: "fixture-inherited", expectedRevision: inherited.revision,
      expectedModelFingerprint: inherited.effectiveBrowserModel.fingerprint });
    expect(result.text).toBe("routed:a");
    expect(result.inherited).toBe(true);
    expect(requests[1].authorization).toBe("Bearer fixture-only-a");
    const beforeRejected = requests.length;
    await expect(call("browser_model_request", { ...request, requestId: "fixture-rejected", prompt: "fixture-reject",
      expectedRevision: inherited.revision, expectedModelFingerprint: inherited.effectiveBrowserModel.fingerprint })).rejects.toThrow("module_model_request_failed");
    expect(requests).toHaveLength(beforeRejected + 1);
    hold = true;
    const started = new Promise<void>(resolve => { observed = resolve; });
    const pending = call("browser_model_request", { ...request, requestId: "fixture-cancel", expectedRevision: inherited.revision,
      expectedModelFingerprint: inherited.effectiveBrowserModel.fingerprint });
    const rejection = expect(pending).rejects.toThrow("module_model_request_cancelled");
    await started;
    await expect(call("browser_model_request", { ...request, expectedRevision: inherited.revision,
      expectedModelFingerprint: inherited.effectiveBrowserModel.fingerprint })).rejects.toThrow("module_model_request_busy");
    expect(await call("cancel_browser_model_request", { requestId: "wrong" })).toEqual({ cancelled: false });
    expect(await call("cancel_browser_model_request", { requestId: "fixture-cancel" })).toEqual({ cancelled: true });
    await rejection;
    expect(current?.id).toBe("a");

    const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSQ0AAAAASUVORK5CYII=";
    const visionRequest = { ...request, requestId: "fixture-image", prompt: "Describe the visible pixel.", image: pixel,
      expectedRevision: inherited.revision, expectedModelFingerprint: inherited.effectiveBrowserModel.fingerprint };
    const beforeImage = requests.length;
    expect(inherited.effectiveBrowserModel.supportsImages).toBe(false);
    await expect(call("browser_model_request", visionRequest)).rejects.toThrow("module_model_image_unsupported");
    disabled.delete("fixture-b");
    const selected = await call("save_module_model", { module: "browser", selection: { provider: "fixture-b", modelId: "b" }, expectedRevision: inherited.revision });
    expect(selected.effectiveBrowserModel.supportsImages).toBe(true);
    const confirmed = { ...visionRequest, expectedRevision: selected.revision,
      expectedModelFingerprint: selected.effectiveBrowserModel.fingerprint };
    await expect(call("browser_model_request", { ...confirmed, confirmed: false })).rejects.toThrow("module_model_confirmation_required");
    await expect(call("browser_model_request", { ...confirmed, image: "https://example.org/never-fetch" })).rejects.toThrow("module_model_image_invalid");
    const oversized = Buffer.from(pixel, "base64");
    oversized.writeUInt32BE(385, 16);
    await expect(call("browser_model_request", { ...confirmed, image: oversized.toString("base64") })).rejects.toThrow("module_model_image_invalid");
    expect(requests).toHaveLength(beforeImage);
    expect(imageRequests).toHaveLength(0);
    const visual = await call("browser_model_request", confirmed);
    expect(visual.text).toBe("routed:b");
    expect(requests).toHaveLength(beforeImage + 1);
    expect(imageRequests).toEqual([expect.objectContaining({ type: "input_image", image_url: `data:image/png;base64,${pixel}` })]);
  } finally {
    held?.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 15000);
