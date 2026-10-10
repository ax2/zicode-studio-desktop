import { afterEach, expect, it, vi } from "vitest";
import { cancelPluginCall } from "./plugin-cancel-client";
import { createPluginInvokeClient } from "./plugin-invoke-client";

const binding = {
  origin: "http://127.0.0.1:57620",
  token: "private-cancel-fixture-token",
  runtimeId: "runtime-a",
  sessionId: "session-a",
};
const accepted = (status = "requested") =>
  new Response(
    JSON.stringify({ schemaVersion: 1, status, executionFinished: status === "finished" }),
  );
afterEach(() => vi.useRealTimers());

it("uses an independent bounded request bound to the original invocation identity", async () => {
  const controller = new AbortController();
  let begun!: () => void;
  const started = new Promise<void>((resolve) => {
    begun = resolve;
  });
  const requests: Array<[string, RequestInit]> = [];
  const request = vi.fn(async (url: string, options: RequestInit) => {
    requests.push([url, options]);
    if (url.endsWith("/invoke")) {
      begun();
      return new Promise<Response>(() => {});
    }
    expect(options.signal?.aborted).toBe(false);
    expect(options.signal).not.toBe(requests[0][1].signal);
    return accepted();
  });
  const call = createPluginInvokeClient(binding, request as typeof fetch)(
    { toolCallId: "call-a", input: { text: "private input" } },
    controller.signal,
  );
  const assertion = expect(call).rejects.toThrow(
    "Host cancellation requested; termination not confirmed",
  );
  await started;
  controller.abort("private abort reason");
  await assertion;
  expect(requests.map(([url]) => url)).toEqual([
    `${binding.origin}/v2/plugin-tools/invoke`,
    `${binding.origin}/v2/plugin-tools/cancel`,
  ]);
  expect(JSON.parse(requests[1][1].body as string)).toEqual({
    schemaVersion: 1,
    runtimeId: binding.runtimeId,
    sessionId: binding.sessionId,
    toolCallId: "call-a",
  });
});
it("does not issue invoke or cancel when already cancelled, and does not cancel successful calls", async () => {
  const request = vi.fn(async () => new Response('{"result":"done"}'));
  const controller = new AbortController();
  controller.abort();
  await expect(
    createPluginInvokeClient(binding, request as typeof fetch)(
      { toolCallId: "before" },
      controller.signal,
    ),
  ).rejects.toThrow("plugin_request_cancelled");
  expect(request).not.toHaveBeenCalled();
  expect(
    await createPluginInvokeClient(binding, request as typeof fetch)({ toolCallId: "success" }),
  ).toBe("done");
  expect(request).toHaveBeenCalledOnce();
});
it("times out invoke then attempts cancel, without reporting termination from acceptance", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (url: string) =>
    url.endsWith("/cancel") ? accepted("pending") : new Promise<Response>(() => {}),
  );
  const call = createPluginInvokeClient(
    binding,
    request as typeof fetch,
  )({ toolCallId: "timeout" });
  const assertion = expect(call).rejects.toThrow("plugin_request_timeout");
  await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
  await expect(call).rejects.toThrow("termination not confirmed");
  expect(request).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds stalled cancellation headers and body independently to two seconds", async () => {
  vi.useFakeTimers();
  for (const body of [false, true]) {
    const request = body
      ? async () => new Response(new ReadableStream())
      : () => new Promise<Response>(() => {});
    const call = cancelPluginCall(binding, request as typeof fetch, "cancel-timeout");
    await vi.advanceTimersByTimeAsync(2000);
    expect(await call).toEqual({ status: "unconfirmed", reason: "plugin_cancel_timeout" });
    expect(vi.getTimerCount()).toBe(0);
  }
});
it("distinguishes unavailable/rejected/malformed/oversized responses without exposing server data", async () => {
  for (const [response, reason] of [
    [new Response(binding.token, { status: 404 }), "plugin_cancel_unavailable"],
    [new Response(binding.token, { status: 403 }), "plugin_cancel_rejected"],
    [
      new Response('{"schemaVersion":1,"status":"requested","executionFinished":true}'),
      "plugin_cancel_response_invalid",
    ],
    [new Response("x".repeat(8193)), "plugin_cancel_response_too_large"],
  ] as const) {
    expect(await cancelPluginCall(binding, (async () => response) as typeof fetch, "call")).toEqual(
      { status: "unconfirmed", reason },
    );
  }
  expect(
    await cancelPluginCall(binding, (async () => accepted("finished")) as typeof fetch, "call"),
  ).toEqual({ status: "finished" });
  expect(
    await cancelPluginCall(
      binding,
      (async () => {
        throw new Error(binding.token);
      }) as typeof fetch,
      "call",
    ),
  ).toEqual({ status: "unconfirmed", reason: "plugin_cancel_transport_error" });
});
