import type { BrokerBinding } from "./plugin-catalog-client";
import { awaitPluginRequest } from "./plugin-request-wait";

type Cancellation = {
  status: "pending" | "requested" | "finished" | "unconfirmed";
  reason?: string;
};
export async function cancelPluginCall(
  binding: BrokerBinding,
  request: typeof fetch,
  toolCallId: unknown,
): Promise<Cancellation> {
  if (typeof toolCallId !== "string" || !toolCallId || Buffer.byteLength(toolCallId) > 256)
    return { status: "unconfirmed", reason: "plugin_cancel_identity_invalid" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await awaitPluginRequest(
      request(`${binding.origin}/v2/plugin-tools/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${binding.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          runtimeId: binding.runtimeId,
          sessionId: binding.sessionId,
          toolCallId,
        }),
        signal: controller.signal,
      }),
      controller.signal,
    );
    if (!response.ok)
      return {
        status: "unconfirmed",
        reason: response.status === 404 ? "plugin_cancel_unavailable" : "plugin_cancel_rejected",
      };
    reader = response.body?.getReader();
    if (!reader) return { status: "unconfirmed", reason: "plugin_cancel_response_invalid" };
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await awaitPluginRequest(reader.read(), controller.signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8192)
        return { status: "unconfirmed", reason: "plugin_cancel_response_too_large" };
      chunks.push(chunk.value);
    }
    const payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (
      payload?.schemaVersion !== 1 ||
      !["pending", "requested", "finished"].includes(payload.status) ||
      payload.executionFinished !== (payload.status === "finished")
    )
      return { status: "unconfirmed", reason: "plugin_cancel_response_invalid" };
    return { status: payload.status };
  } catch {
    return {
      status: "unconfirmed",
      reason: controller.signal.aborted ? "plugin_cancel_timeout" : "plugin_cancel_transport_error",
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export function cancellationMessage(outcome: Cancellation): string {
  if (outcome.status === "finished")
    return "Host call already finished; cancellation does not undo its effects";
  if (outcome.status === "pending")
    return "Host recorded cancellation before execution; termination not confirmed";
  if (outcome.status === "requested")
    return "Host cancellation requested; termination not confirmed";
  return `Host cancellation unconfirmed (${outcome.reason}); execution may continue within its existing budget`;
}
