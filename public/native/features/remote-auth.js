import { randomId } from "../utils/random-id.js";

const DEVICE_ID_KEY = "picot-remote-device-id";
const DEVICE_TOKEN_KEY = "picot-remote-device-token";
const PAIRING_QUERY_KEY = "pairingToken";
const E2EE_KEY_QUERY_KEY = "ek";
const E2EE_KEY_STORAGE = "picot-remote-e2ee-key";

function remoteAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function isLoopbackHost(hostname = globalThis.location?.hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function remoteDeviceId(storage = globalThis.localStorage) {
  let deviceId = storage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `device-${randomId()}`;
    storage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function remoteDeviceName(navigatorRef = globalThis.navigator) {
  const userAgent = navigatorRef?.userAgent || "";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/Android/i.test(userAgent)) return "Android device";
  const platform = navigatorRef?.userAgentData?.platform || navigatorRef?.platform;
  return typeof platform === "string" && platform.trim() ? platform.trim() : "Mobile device";
}

/**
 * 手机在配对链接/二维码中带外获得桌面 E2EE 静态公钥（base64，32 字节），
 * 与设备令牌一起持久化固定。之后每次连接中继都以此公钥执行 Noise_XK
 * 握手，防止被中继中间人替换桌面身份。
 */
export function remoteE2eePublicKey(storage = globalThis.localStorage) {
  return storage.getItem(E2EE_KEY_STORAGE) || "";
}

function storePinnedE2eeKey(storage, value) {
  if (!value) return;
  try {
    const decoded = atob(value);
    if (decoded.length !== 32) return;
    storage.setItem(E2EE_KEY_STORAGE, value);
  } catch {
    // 非法 base64 视为未携带公钥，保持 M1。
  }
}

export async function resolveRemoteAuth({
  location = globalThis.location,
  history = globalThis.history,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  navigatorRef = globalThis.navigator,
} = {}) {
  const url = new URL(location.href);
  const pairingToken = url.searchParams.get(PAIRING_QUERY_KEY);
  const e2eeKey = url.searchParams.get(E2EE_KEY_QUERY_KEY);
  if (pairingToken || e2eeKey) {
    url.searchParams.delete(PAIRING_QUERY_KEY);
    url.searchParams.delete(E2EE_KEY_QUERY_KEY);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (e2eeKey) storePinnedE2eeKey(storage, e2eeKey);
  }
  if (pairingToken) {
    const response = await fetchImpl("/v2/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairingToken,
        deviceId: remoteDeviceId(storage),
        deviceName: remoteDeviceName(navigatorRef),
      }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw remoteAuthError(
          "pairing_rate_limited",
          "Too many pairing attempts. Wait a minute and request a new link.",
        );
      }
      throw remoteAuthError(
        "pairing_rejected",
        "The mobile pairing link expired or was already used.",
      );
    }
    const body = await response.json();
    if (!body?.deviceToken) {
      throw remoteAuthError("pairing_failed", "Mobile pairing did not return a device token.");
    }
    storage.setItem(DEVICE_TOKEN_KEY, body.deviceToken);
  }

  const deviceToken = storage.getItem(DEVICE_TOKEN_KEY) || "";
  if (isLoopbackHost(url.hostname)) {
    return { clientType: "desktop", deviceToken: "" };
  }
  if (!deviceToken) {
    throw remoteAuthError(
      "device_pairing_required",
      "This device is not paired with ZiCode Studio Desktop.",
    );
  }
  return { clientType: "remote", deviceToken };
}

export function createAuthenticatedHostFetch({
  deviceToken = "",
  location = globalThis.location,
  fetchImpl = globalThis.fetch,
} = {}) {
  const hostOrigin = location?.origin;
  return (input, init) => {
    if (!deviceToken || !hostOrigin) return fetchImpl(input, init);
    const requestUrl = new URL(
      typeof input === "string" || input instanceof URL ? String(input) : input.url,
      hostOrigin,
    );
    if (requestUrl.origin !== hostOrigin) return fetchImpl(input, init);
    const headers = new Headers(init?.headers ?? input?.headers);
    headers.set("authorization", `Bearer ${deviceToken}`);
    return fetchImpl(input, { ...init, headers });
  };
}
