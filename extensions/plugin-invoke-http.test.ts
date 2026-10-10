// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { createPluginInvokeClient } from "./plugin-invoke-client";

it("bounds real HTTP response waiting, cancels its connection and keeps the next tool usable", async () => {
  const closed: Promise<void>[] = [];
  const cancellations: string[] = [];
  let headersStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    headersStarted = resolve;
  });
  const server = createServer(async (req, res) => {
    expect(["/v2/plugin-tools/invoke", "/v2/plugin-tools/cancel"]).toContain(req.url);
    expect(req.headers.authorization).toBe("Bearer http-fixture-token");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(input.runtimeId).toBe("http-runtime");
    expect(input.sessionId).toBe("http-session");
    if (req.url === "/v2/plugin-tools/cancel") {
      expect(input.schemaVersion).toBe(1);
      cancellations.push(input.toolCallId);
      res.end('{"schemaVersion":1,"status":"requested","executionFinished":false}');
      return;
    }
    if (input.toolName === "stalled_body") {
      closed.push(new Promise<void>((resolve) => res.once("close", resolve)));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"result":"');
    } else if (input.toolName === "stalled_headers") {
      closed.push(new Promise<void>((resolve) => res.once("close", resolve)));
      headersStarted();
    } else {
      res.end('{"result":{"text":"next tool works"}}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const binding = {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    token: "http-fixture-token",
    runtimeId: "http-runtime",
    sessionId: "http-session",
  };
  const invoke = createPluginInvokeClient(binding, fetch);
  try {
    const start = Date.now();
    await expect(invoke({ toolName: "stalled_body", toolCallId: "body-timeout" })).rejects.toThrow(
      "plugin_request_timeout",
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(14_500);
    expect(Date.now() - start).toBeLessThan(20_000);
    const cancel = new AbortController();
    const call = invoke(
      { toolName: "stalled_headers", toolCallId: "headers-cancel" },
      cancel.signal,
    );
    const assertion = expect(call).rejects.toThrow("plugin_request_cancelled");
    await started;
    cancel.abort();
    await assertion;
    await Promise.all(closed);
    expect(cancellations).toEqual(["body-timeout", "headers-cancel"]);
    expect(await invoke({ toolName: "next" })).toEqual({ text: "next tool works" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 25_000);
