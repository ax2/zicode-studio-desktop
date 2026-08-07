export interface StartupFailureCopy {
  title: string;
  message: string;
  guidance: string;
}

export function startupFailureCopy(code: string): StartupFailureCopy {
  if (code === "device_pairing_required") {
    return {
      title: "This device is not paired",
      message: "This browser is not paired with your ZiCode desktop yet.",
      guidance:
        'On your computer, open the target conversation in ZiCode, click the mobile QR icon next to the title, then scan the QR with this device — or click "Open link" in that window to pair this browser directly. Each link works once and expires in 5 minutes.',
    };
  }
  if (code === "device_access_revoked") {
    return {
      title: "Access to this device was revoked",
      message: "ZiCode closed the remote connection and stopped reconnecting.",
      guidance:
        "Generate a new mobile link from the trusted desktop app if this device should reconnect.",
    };
  }
  if (code === "pairing_rejected" || code === "pairing_failed") {
    return {
      title: "The mobile link is no longer valid",
      message: "The pairing link expired, was already used, or could not be exchanged.",
      guidance: "Return to the trusted desktop app and generate a new mobile link.",
    };
  }
  if (code === "pairing_rate_limited") {
    return {
      title: "Too many pairing attempts",
      message: "ZiCode temporarily blocked pairing attempts from this device.",
      guidance:
        "Wait one minute, then generate a fresh mobile link from the trusted desktop app.",
    };
  }
  if (code === "desktop_offline") {
    return {
      title: "The desktop is offline",
      message: "ZiCode Studio Desktop is not reachable right now.",
      guidance:
        "Open ZiCode Studio Desktop on your computer, wait a few seconds, then retry.",
    };
  }
  return {
    title: "ZiCode could not start",
    message: "The local Host is unavailable or the session route could not be opened.",
    guidance: "Check that ZiCode Studio Desktop is running, then try again.",
  };
}
