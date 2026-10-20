import { cancellationMessage, cancelPluginCall } from "./plugin-cancel-client";
import type { BrokerBinding } from "./plugin-catalog-client";
import { awaitPluginRequest as abortable } from "./plugin-request-wait";

const RESPONSE_LIMIT = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
class PluginClientError extends Error {}
const HOST_CODES = new Set([
  "invalid_parameters",
  "registry_unavailable",
  "tool_unavailable",
  "capability_broker_unavailable",
  "broker_auth_required",
  "broker_auth_unavailable",
  "broker_token_invalid",
  "runtime_stopped",
  "catalog_request_invalid",
  "catalog_revision_changed",
  "plugin_integrity_invalid",
  "capability_unavailable",
  "permission_denied",
  "idempotency_conflict",
  "idempotency_authority_changed",
  "plugin_not_active",
  "input_too_large",
  "payload_too_large",
  "result_too_large",
  "worker_timeout",
  "worker_cancelled",
  "plugin_call_in_progress",
  "plugin_call_budget_exceeded",
  "worker_failed",
  "worker_fuel_exhausted",
  "worker_memory_trap",
  "worker_stack_exhausted",
  "worker_trapped",
  "worker_exit_failed",
  "worker_protocol_error",
  "worker_unavailable",
  "worker_output_too_large",
]);

export type PluginInvokeEnvelope = { result: unknown; resultRef?: unknown; resultCaptureError?: unknown };

export function createPluginInvokeEnvelopeClient(binding: BrokerBinding, request: typeof fetch) {
  return async (input: Record<string, unknown>, signal?: AbortSignal): Promise<PluginInvokeEnvelope> => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let issued = false;
    try {
      controller.signal.throwIfAborted();
      issued = true;
      const response = await abortable(
        request(`${binding.origin}/v2/plugin-tools/invoke`, {
          method: "POST",
          headers: { Authorization: `Bearer ${binding.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            runtimeId: binding.runtimeId,
            sessionId: binding.sessionId,
          }),
          signal: controller.signal,
        }),
        controller.signal,
      );
      reader = response.body?.getReader();
      if (!reader)
        throw new PluginClientError(
          "[plugin_response_invalid] Plugin Host returned an invalid response",
        );
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await abortable(reader.read(), controller.signal);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > RESPONSE_LIMIT)
          throw new PluginClientError(
            "[plugin_response_too_large] Plugin Host response exceeds 2 MiB",
          );
        chunks.push(chunk.value);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
        );
      } catch {
        throw new PluginClientError(
          "[plugin_response_invalid] Plugin Host returned an invalid response",
        );
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new PluginClientError(
          "[plugin_response_invalid] Plugin Host returned an invalid response",
        );
      }
      if (!response.ok) {
        const code = (payload as { error?: { code?: unknown } }).error?.code;
        const safeCode =
          typeof code === "string" && HOST_CODES.has(code) ? code : `http_${response.status}`;
        throw new PluginClientError(
          safeCode === "idempotency_authority_changed"
            ? `[${safeCode}] Review the previous effect before starting another call`
            : `[${safeCode}] Plugin call failed; check authorization or refresh the tool catalog`,
        );
      }
      if (!Object.hasOwn(payload, "result"))
        throw new PluginClientError("[plugin_response_invalid] Plugin Host returned no result");
      return payload as PluginInvokeEnvelope;
    } catch (error) {
      if (signal?.aborted || timedOut) {
        clearTimeout(timer);
        const suffix = issued
          ? `; ${cancellationMessage(await cancelPluginCall(binding, request, input.toolCallId))}`
          : "";
        throw new Error(
          `${signal?.aborted ? "[plugin_request_cancelled] Plugin call cancelled" : "[plugin_request_timeout] Plugin Host request timed out"}${suffix}`,
        );
      }
      if (error instanceof PluginClientError) throw error;
      throw new Error(
        "[plugin_transport_error] Cannot contact Plugin Host; retry or restart this session",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      controller.abort();
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  };
}

export function createPluginInvokeClient(binding: BrokerBinding, request: typeof fetch) {
  const invoke = createPluginInvokeEnvelopeClient(binding, request);
  return async (input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> =>
    (await invoke(input, signal)).result;
}
