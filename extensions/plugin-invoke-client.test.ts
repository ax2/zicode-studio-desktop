import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginInvokeClient } from "./plugin-invoke-client";

const binding = {
  origin: "http://127.0.0.1:57620",
  token: "private-fixture-token",
  runtimeId: "runtime-a",
  sessionId: "session-a",
};
const response = (text: string, status = 200) => new Response(text, { status });
afterEach(() => vi.useRealTimers());

describe("plugin invoke transport", () => {
  it("keeps fixed budget failure codes and hides raw messages", async () => {
    for (const code of [
      "worker_fuel_exhausted",
      "worker_memory_trap",
      "worker_stack_exhausted",
      "worker_trapped",
      "worker_exit_failed",
    ]) {
      const request = vi.fn(async () =>
        response(JSON.stringify({ error: { code, message: "private report" } }), 409),
      );
      await expect(
        createPluginInvokeClient(
          binding,
          request as typeof fetch,
        )({ toolName: "fixture", input: {} }),
      ).rejects.toThrow(code);
    }
  });
  it("binds identity and returns real streamed JSON", async () => {
    const request = vi.fn(async (_url: string, _options: RequestInit) =>
      response('{"result":{"text":"你好"}}'),
    );
    expect(
      await createPluginInvokeClient(
        binding,
        request as typeof fetch,
      )({
        runtimeId: "override",
        sessionId: "override",
        toolName: "fixture",
        input: { text: "test" },
      }),
    ).toEqual({ text: "你好" });
    expect(JSON.parse(request.mock.calls[0][1].body as string)).toMatchObject({
      runtimeId: binding.runtimeId,
      sessionId: binding.sessionId,
    });
  });
  it("enforces the exact byte boundary independently of content length", async () => {
    const empty = '{"result":""}';
    for (const extra of [0, 1]) {
      const text = `{"result":"${"x".repeat(2 * 1024 * 1024 - Buffer.byteLength(empty) + extra)}"}`;
      const request = vi.fn(async () => response(text));
      const call = createPluginInvokeClient(binding, request as typeof fetch)({});
      if (extra) await expect(call).rejects.toThrow("plugin_response_too_large");
      else expect(((await call) as string).length).toBe(2 * 1024 * 1024 - Buffer.byteLength(empty));
    }
  });
  it("rejects invalid JSON, invalid UTF8, arrays, empty bodies and missing result", async () => {
    for (const body of ["broken", "[]", "{}", "", new Uint8Array([0xff])]) {
      await expect(
        createPluginInvokeClient(binding, (async () => new Response(body)) as typeof fetch)({}),
      ).rejects.toThrow("plugin_response_invalid");
    }
  });
  it("cancels before issuing a request and during stalled body reads", async () => {
    const request = vi.fn(async () => response('{"result":true}'));
    const cancelled = new AbortController();
    cancelled.abort("private caller reason");
    await expect(
      createPluginInvokeClient(binding, request as typeof fetch)({}, cancelled.signal),
    ).rejects.toThrow("plugin_request_cancelled");
    expect(request).not.toHaveBeenCalled();
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const call = createPluginInvokeClient(
      binding,
      (async () => new Response(stream)) as typeof fetch,
    )({}, controller.signal);
    const assertion = expect(call).rejects.toThrow("plugin_request_cancelled");
    await Promise.resolve();
    controller.abort("private caller reason");
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("times out stalled headers and response streams even when fetch ignores cancellation", async () => {
    vi.useFakeTimers();
    for (const body of [false, true]) {
      const cancel = vi.fn();
      const request = body
        ? async () => new Response(new ReadableStream<Uint8Array>({ cancel }))
        : () => new Promise<Response>(() => {});
      const call = createPluginInvokeClient(binding, request as typeof fetch)({});
      const assertion = expect(call).rejects.toThrow("plugin_request_timeout");
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
      if (body) expect(cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it("never propagates server messages, transport secrets or unsafe error codes", async () => {
    for (const [request, expected] of [
      [
        async () =>
          response(
            JSON.stringify({ error: { code: "permission_denied", message: binding.token } }),
            403,
          ),
        "permission_denied",
      ],
      [
        async () =>
          response(JSON.stringify({ error: { code: binding.token, message: binding.token } }), 500),
        "http_500",
      ],
      [
        async () =>
          response(
            JSON.stringify({ error: { code: "private_secret_token", message: binding.token } }),
            500,
          ),
        "http_500",
      ],
      [
        async () => {
          throw new Error(`[plugin_response_invalid] ${binding.token}`);
        },
        "plugin_transport_error",
      ],
    ] as const) {
      const call = createPluginInvokeClient(binding, request as typeof fetch)({});
      await expect(call).rejects.toThrow(expected);
      await expect(call).rejects.not.toThrow(binding.token);
    }
  });
  it("permits another tool invocation after one request fails", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response("broken"))
      .mockResolvedValueOnce(response('{"result":null}'));
    const invoke = createPluginInvokeClient(binding, request);
    await expect(invoke({})).rejects.toThrow("plugin_response_invalid");
    expect(await invoke({})).toBeNull();
  });
  it("keeps authority conflicts explicit without retrying or exposing server messages", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        response(
          JSON.stringify({
            error: { code: "idempotency_authority_changed", message: binding.token },
          }),
          409,
        ),
      );
    const call = createPluginInvokeClient(binding, request)({ toolCallId: "old-call" });
    await expect(call).rejects.toThrow(
      "[idempotency_authority_changed] Review the previous effect",
    );
    await expect(call).rejects.not.toThrow(binding.token);
    expect(request).toHaveBeenCalledOnce();
  });
});
