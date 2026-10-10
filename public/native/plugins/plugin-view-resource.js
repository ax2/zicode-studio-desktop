const MAX_CHUNK = 32 * 1024;
const KEYS = new Set(["capabilityId", "resourceId", "contentVersion", "offset", "length"]);
const CODES = new Set([
  "resource_busy",
  "resource_unavailable",
  "resource_confirmation_required",
  "permission_denied",
  "runtime_stopped",
  "resource_plugin_unavailable",
  "broker_token_invalid",
  "resource_range_invalid",
]);

export function resourceViewTarget(target) {
  return JSON.stringify([
    target?.instanceId,
    target?.sessionId,
    target?.workspaceId,
    target?.sceneId ?? "programming",
  ]);
}

export async function readPluginViewResource({ instance, gateway, target, params, isCurrent }) {
  const fail = (code) => {
    throw new Error(`[${code}]`);
  };
  if (
    !params ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    Object.keys(params).some((key) => !KEYS.has(key))
  )
    fail("resource_request_invalid");
  const { capabilityId, resourceId, contentVersion, offset = 0, length = MAX_CHUNK } = params;
  if (
    typeof capabilityId !== "string" ||
    !capabilityId.trim() ||
    capabilityId.length > 256 ||
    typeof resourceId !== "string" ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(resourceId) ||
    typeof contentVersion !== "string" ||
    !/^[0-9a-f]{64}$/.test(contentVersion) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 32 * 1024 * 1024 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > MAX_CHUNK
  )
    fail("resource_request_invalid");
  if (!target?.instanceId || !target?.sessionId || !isCurrent()) fail("resource_view_changed");
  if (typeof gateway?.readResource !== "function") fail("resource_gateway_unavailable");
  let result;
  try {
    result = await gateway.readResource(
      {
        runtimeId: target.instanceId,
        sessionId: target.sessionId,
        pluginId: instance.plugin.id,
        capabilityId,
      },
      { resourceId, contentVersion, offset, length },
    );
  } catch (error) {
    fail(CODES.has(error?.code) ? error.code : "resource_read_failed");
  }
  if (!isCurrent()) fail("resource_view_changed");
  if (
    result?.schemaVersion !== 1 ||
    result.resourceId !== resourceId ||
    result.contentVersion !== contentVersion ||
    result.offset !== offset ||
    typeof result.eof !== "boolean" ||
    !Number.isSafeInteger(result.byteLength) ||
    result.byteLength < 0 ||
    result.byteLength > length ||
    offset + result.byteLength > 32 * 1024 * 1024 ||
    (!result.eof && result.byteLength !== length) ||
    typeof result.dataBase64 !== "string" ||
    result.dataBase64.length > Math.ceil(MAX_CHUNK / 3) * 4
  )
    fail("resource_response_invalid");
  try {
    const bytes = atob(result.dataBase64);
    if (bytes.length !== result.byteLength || btoa(bytes) !== result.dataBase64)
      fail("resource_response_invalid");
  } catch {
    fail("resource_response_invalid");
  }
  // Do not forward unknown Host fields, including possible paths or credentials.
  return {
    schemaVersion: 1,
    resourceId,
    contentVersion,
    offset,
    byteLength: result.byteLength,
    eof: result.eof,
    dataBase64: result.dataBase64,
  };
}
