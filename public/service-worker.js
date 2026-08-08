const CACHE_NAME = "zicode-mobile-shell-v4";
const OFFLINE_URL = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_URL, "/offline.js", "/offline-entry.js"];
const SHARE_TARGET_PATH = "/share-target";
// In relay mode the manifest's share_target.action is rewritten into the
// device scope (/d/{device}/app/share-target); the service worker serves the
// same scope, so its fetch handler must recognize both path shapes.
const DEVICE_SHARE_TARGET_PATH = /^\/d\/[^/]+\/app\/share-target$/;
const SHARE_TARGET_STORAGE_KEY = "zicode-mobile-share-target";
const SHARE_INBOX_DB = "zicode-mobile-share-inbox-v1";
const SHARE_INBOX_STORE = "shares";
const SHARE_IMAGE_MAX_AGE_MS = 10 * 60 * 1000;
const SHARE_IMAGE_MAX_COUNT = 4;
const SHARE_IMAGE_MAX_FILE_BYTES = 8 * 1024 * 1024;
const SHARE_IMAGE_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const SHARE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const SHARE_IMAGE_EXTENSIONS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

function shareField(formData, name, maxLength) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function imageMimeType(file) {
  const declaredType = String(file?.type || "").toLowerCase();
  if (SHARE_IMAGE_TYPES.has(declaredType)) return declaredType;
  const name = String(file?.name || "").toLowerCase();
  const extension = [...SHARE_IMAGE_EXTENSIONS.keys()].find((candidate) => name.endsWith(candidate));
  return SHARE_IMAGE_EXTENSIONS.get(extension) || "";
}

function collectSharedImages(formData) {
  const candidates = Array.from(formData.getAll?.("images") || []);
  const files = [];
  let totalBytes = 0;
  let error = "";
  for (const file of candidates) {
    const type = imageMimeType(file);
    const size = Number(file?.size);
    if (!type || typeof file?.slice !== "function" || !Number.isFinite(size) || size <= 0) {
      error = "unsupported";
      continue;
    }
    if (
      files.length >= SHARE_IMAGE_MAX_COUNT ||
      size > SHARE_IMAGE_MAX_FILE_BYTES ||
      totalBytes + size > SHARE_IMAGE_MAX_TOTAL_BYTES
    ) {
      error = "too_large";
      continue;
    }
    totalBytes += size;
    const fallbackExtension = type === "image/jpeg" ? "jpg" : type.split("/")[1];
    const originalName = String(file.name || `shared-image-${files.length + 1}.${fallbackExtension}`);
    const name = (originalName.split(/[\\/]/).at(-1) || "shared-image").slice(0, 255);
    files.push({
      blob: file.slice(0, size, type),
      lastModified: Number(file.lastModified) || Date.now(),
      name,
      type,
    });
  }
  return { error, files };
}

function openShareInbox() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_INBOX_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SHARE_INBOX_STORE)) {
        database.createObjectStore(SHARE_INBOX_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open share inbox"));
    request.onblocked = () => reject(new Error("Share inbox is blocked"));
  });
}

function shareInboxTransactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Share inbox failed"));
    transaction.onabort = () => reject(transaction.error || new Error("Share inbox was aborted"));
  });
}

function updateShareInbox(database, { record = null, now = Date.now() } = {}) {
  const transaction = database.transaction(SHARE_INBOX_STORE, "readwrite");
  const completion = shareInboxTransactionDone(transaction);
  const store = transaction.objectStore(SHARE_INBOX_STORE);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error || new Error("Could not read share inbox"));
    request.onsuccess = () => {
      for (const existing of request.result || []) {
        const age = now - Number(existing?.createdAt);
        if (!Number.isFinite(age) || age < -60_000 || age > SHARE_IMAGE_MAX_AGE_MS) {
          store.delete(existing.id);
        }
      }
      if (record) store.put(record);
      resolve();
    };
  }).then(() => completion);
}

async function storeSharedImages(files, createdAt) {
  const id = crypto.randomUUID?.() ||
    [...crypto.getRandomValues(new Uint8Array(16))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const database = await openShareInbox();
  try {
    await updateShareInbox(database, { record: { createdAt, files, id }, now: createdAt });
    return id;
  } finally {
    database.close();
  }
}

async function cleanupShareInbox() {
  const database = await openShareInbox();
  try {
    await updateShareInbox(database);
  } finally {
    database.close();
  }
}

function shareTargetLanding(payload) {
  const encoded = base64Utf8(JSON.stringify(payload));
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZiCode Studio</title></head>
<body><p>正在准备分享内容… / Preparing shared content…</p><a href="/">打开 ZiCode / Open ZiCode</a>
<script>
try {
  const bytes = Uint8Array.from(atob("${encoded}"), (character) => character.charCodeAt(0));
  sessionStorage.setItem("${SHARE_TARGET_STORAGE_KEY}", new TextDecoder().decode(bytes));
  const savedPath = localStorage.getItem("zicode-mobile-start-route") || "";
  const parts = savedPath.split("/");
  const validId = (value) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
  const safePath = parts.length === 6 && parts[1] === "app" && parts[2] === "workspaces" && validId(parts[3]) && parts[4] === "sessions" && validId(parts[5]) && !savedPath.includes("?") && !savedPath.includes("#");
  location.replace(safePath ? savedPath : "/");
} catch { location.replace("/"); }
</script></body></html>`;
  return new Response(html, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

async function handleShareTargetRequest(request) {
  try {
    const formData = await request.formData();
    const createdAt = Date.now();
    const payload = {
      createdAt,
      title: shareField(formData, "title", 512),
      text: shareField(formData, "text", 32_768),
      url: shareField(formData, "url", 2_048),
    };
    const sharedImages = collectSharedImages(formData);
    if (sharedImages.files.length > 0) {
      try {
        payload.imageShareId = await storeSharedImages(sharedImages.files, createdAt);
      } catch {
        payload.imageError = "storage";
      }
    }
    if (sharedImages.error) payload.imageError = sharedImages.error;
    if (!payload.title && !payload.text && !payload.url && !payload.imageShareId) {
      payload.error = payload.imageError || "empty";
    }
    return shareTargetLanding(payload);
  } catch {
    return shareTargetLanding({ createdAt: Date.now(), error: "invalid" });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
        ),
      cleanupShareInbox().catch(() => {}),
    ])
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin === self.location.origin &&
    (url.pathname === SHARE_TARGET_PATH || DEVICE_SHARE_TARGET_PATH.test(url.pathname)) &&
    event.request.method === "POST" &&
    event.request.mode === "navigate"
  ) {
    event.respondWith(handleShareTargetRequest(event.request));
    return;
  }
  if (url.origin === self.location.origin && OFFLINE_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
  }
});

function safeNotificationPath(value) {
  return /^\/app\/workspaces\/[^/?#]+\/sessions\/[^/?#]+(?:#.*)?$/.test(value || "")
    ? value
    : "/";
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeNotificationPath(event.notification.data?.path);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const matching = windowClients.find((client) => {
          try {
            return new URL(client.url).pathname === path.split("#")[0];
          } catch {
            return false;
          }
        });
        const target = matching || windowClients[0];
        if (target?.focus) return target.focus();
        return self.clients.openWindow(path);
      }),
  );
});
