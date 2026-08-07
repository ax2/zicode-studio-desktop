import { initializeI18n } from "./i18n.js";
import { restoreMobileStartRoute } from "./native/features/mobile-start-route.js";
import { resolveRemoteAuth } from "./native/features/remote-auth.js";
import { renderStartupFailure } from "./native/react/startup-failure.js";
import { parseAppRoute } from "./native/utils/router.js";

function isSecureRemoteHost() {
  return (
    location.protocol === "https:" &&
    !["localhost", "127.0.0.1", "::1"].includes(location.hostname)
  );
}

/**
 * A remote client may open a bare relay URL (e.g.
 * `https://relay.zicode.com/d/<device>/app/`) that has no session route.
 * `app.js` requires a session route, so resolve the workspace's latest
 * session and redirect before booting. Unpaired devices get the pairing
 * screen; an offline desktop gets a clear offline message.
 */
async function resolveBareRemoteRoute() {
  if (parseAppRoute(location.pathname).name === "session" || !isSecureRemoteHost()) {
    return false;
  }
  const auth = await resolveRemoteAuth();
  if (auth.clientType !== "remote" || !auth.deviceToken) return false;
  const response = await fetch("/v2/sessions?workspaceId=", {
    headers: { authorization: `Bearer ${auth.deviceToken}` },
  });
  if (!response.ok) {
    if (response.status === 503) {
      const error = new Error("ZiCode Studio Desktop is offline. Open it on your computer and retry.");
      error.code = "desktop_offline";
      throw error;
    }
    return false;
  }
  const sessions = ((await response.json())?.sessions) || [];
  const latest = sessions.find((session) => session.workspaceId) || sessions[0];
  if (!latest?.workspaceId || !latest?.id) return false;
  location.replace(
    `/app/workspaces/${latest.workspaceId}/sessions/${latest.id}${location.search}`,
  );
  return true;
}

initializeI18n();
(async () => {
  if (restoreMobileStartRoute()) return;
  try {
    if (await resolveBareRemoteRoute()) return;
  } catch (error) {
    renderStartupFailure(error);
    return;
  }
  import("./native/app.js").catch((error) => renderStartupFailure(error));
})();
