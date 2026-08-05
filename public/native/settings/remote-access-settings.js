import { getLocale, t } from "../../i18n.js";

export function setupRemoteAccessSettings({ gateway } = {}) {
  const root = document.getElementById("settings-remote-access");
  if (!root) return null;

  const ONLINE_DEVICE_WINDOW_SECONDS = 90;
  let devices = [];
  let status = { configuredEnabled: false, running: false, restartRequired: false, urls: [] };
  let relayError = "";
  let loading = false;
  let updating = false;

  function formatTime(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return t("Never");
    return new Intl.DateTimeFormat(getLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(seconds * 1000));
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let unit = 0;
    let size = value;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${unit === 0 || size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
  }

  function statusBadge(device, now = Date.now()) {
    const badge = document.createElement("span");
    const revoked = Boolean(device.revokedAt);
    const online =
      !revoked &&
      Number(device.lastSeenAt) > 0 &&
      now / 1000 - Number(device.lastSeenAt) < ONLINE_DEVICE_WINDOW_SECONDS;
    badge.className = `ui-badge remote-device-status ${
      revoked ? "is-revoked" : online ? "is-online" : "is-offline"
    }`;
    badge.textContent = t(revoked ? "Revoked" : online ? "Online" : "Offline");
    return badge;
  }

  function deviceRow(device) {
    const row = document.createElement("article");
    row.className = "ui-card remote-device-card";
    row.dataset.deviceId = device.deviceId;

    const heading = document.createElement("div");
    heading.className = "remote-device-heading";
    const name = document.createElement("strong");
    name.className = "remote-device-name";
    name.textContent = device.deviceName || t("Mobile device");
    heading.append(name, statusBadge(device));

    const metadata = document.createElement("dl");
    metadata.className = "remote-device-metadata";
    const addMetadata = (label, value) => {
      const term = document.createElement("dt");
      term.textContent = t(label);
      const detail = document.createElement("dd");
      detail.textContent = value;
      metadata.append(term, detail);
    };
    addMetadata("Paired on", formatTime(device.pairedAt));
    addMetadata("Last active", formatTime(device.lastSeenAt));

    row.append(heading, metadata);
    if (!device.revokedAt) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "ui-button ui-button--danger ui-button--sm remote-device-revoke";
      revoke.textContent = t("Revoke access");
      let armed = false;
      let resetTimer;
      revoke.addEventListener("click", async () => {
        if (!armed) {
          armed = true;
          revoke.textContent = t("Confirm revoke");
          revoke.setAttribute(
            "aria-label",
            t("Confirm revoke access for {device}").replace("{device}", name.textContent),
          );
          resetTimer = globalThis.setTimeout(() => {
            armed = false;
            revoke.textContent = t("Revoke access");
            revoke.removeAttribute("aria-label");
          }, 5_000);
          return;
        }
        globalThis.clearTimeout(resetTimer);
        revoke.disabled = true;
        revoke.setAttribute("aria-busy", "true");
        try {
          await gateway.revokeDevice(device.deviceId);
          await load();
        } catch (error) {
          renderError(error);
        }
      });
      row.append(revoke);
    }
    return row;
  }

  function renderError(error) {
    const list = root.querySelector("[data-remote-device-list]");
    if (!list) return;
    list.replaceChildren();
    const state = document.createElement("div");
    state.className = "remote-access-state remote-access-error";
    state.setAttribute("role", "alert");
    const message = document.createElement("p");
    message.textContent = t("Could not load paired devices.");
    const detail = document.createElement("p");
    detail.className = "settings-help";
    detail.textContent = error?.message || t("The local Host is unavailable.");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ui-button ui-button--secondary";
    retry.textContent = t("Retry");
    retry.addEventListener("click", () => void load());
    state.append(message, detail, retry);
    list.append(state);
  }

  function render() {
    root.replaceChildren();
    const body = document.createElement("div");
    body.className = "settings-body remote-access-settings";

    const overview = document.createElement("section");
    overview.className = "settings-section remote-access-overview";
    const titleRow = document.createElement("div");
    titleRow.className = "settings-section-title remote-access-title-row";
    const title = document.createElement("span");
    title.textContent = t("Secure mobile access");
    const titleControls = document.createElement("div");
    titleControls.className = "remote-access-title-controls";
    const badge = document.createElement("span");
    badge.className = `ui-badge ${status.running ? "remote-access-on-badge" : "remote-access-off-badge"}`;
    badge.textContent = t(
      status.restartRequired ? "Restart required" : status.running ? "On" : "Off",
    );
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `settings-toggle${status.configuredEnabled ? " on" : ""}`;
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(Boolean(status.configuredEnabled)));
    toggle.setAttribute("aria-label", t("Allow secure access from this local network"));
    toggle.disabled = loading || updating || !gateway;
    toggle.addEventListener("click", async () => {
      if (updating) return;
      updating = true;
      render();
      try {
        status = await gateway.setEnabled(!status.configuredEnabled);
        updating = false;
        render();
      } catch (error) {
        updating = false;
        render();
        renderError(error);
      }
    });
    titleControls.append(badge, toggle);
    titleRow.append(title, titleControls);
    const description = document.createElement("p");
    description.className = "settings-help";
    description.textContent = t(
      "Remote access uses HTTPS/WSS and remains off until you enable it. Restart ZiCode Studio after changing this switch.",
    );
    const readiness = document.createElement("div");
    readiness.className = "remote-access-readiness";
    readiness.setAttribute("role", "status");
    if (status.running) {
      const connectionTitle = document.createElement("strong");
      connectionTitle.textContent = t("Secure addresses");
      const addresses = document.createElement("div");
      addresses.className = "remote-access-addresses";
      for (const url of status.urls ?? []) {
        const code = document.createElement("code");
        code.textContent = url;
        addresses.append(code);
      }
      const setupTitle = document.createElement("strong");
      setupTitle.textContent = t("Phone trust setup");
      const setupAddress = document.createElement("code");
      setupAddress.textContent = status.enrollmentUrls?.[0] ?? t("Unavailable");
      const fingerprint = document.createElement("p");
      fingerprint.className = "remote-access-fingerprint";
      fingerprint.textContent = `${t("CA fingerprint")}: ${status.caFingerprint || t("Unavailable")}`;
      const certificate = document.createElement("a");
      certificate.className = "ui-button ui-button--secondary ui-button--sm remote-access-ca-link";
      certificate.textContent = t("Open certificate setup");
      certificate.href = status.enrollmentUrls?.[0] ?? "";
      certificate.target = "_blank";
      certificate.rel = "noopener noreferrer";
      readiness.append(
        connectionTitle,
        addresses,
        setupTitle,
        setupAddress,
        fingerprint,
        certificate,
      );
    } else {
      readiness.textContent = t(
        status.restartRequired
          ? "Restart ZiCode Studio to apply this remote access change."
          : "Only this computer can connect while secure mobile access is off.",
      );
    }
    overview.append(titleRow, description, readiness);

    const publicSection = document.createElement("section");
    publicSection.className = "settings-section remote-access-public";
    const publicTitle = document.createElement("h3");
    publicTitle.className = "settings-section-title";
    publicTitle.textContent = t("Public internet access");
    const publicHelp = document.createElement("p");
    publicHelp.className = "settings-help";
    publicHelp.textContent = t("Leave empty to disable public access.");

    const publicFields = document.createElement("div");
    publicFields.className = "remote-access-public-fields";
    const httpsInput = document.createElement("input");
    httpsInput.type = "url";
    httpsInput.spellcheck = false;
    httpsInput.autocomplete = "off";
    httpsInput.value = status.publicUrl || "";
    httpsInput.placeholder = "https://www.zicode.com:39010";
    const httpsRow = document.createElement("label");
    httpsRow.className = "settings-field";
    const httpsLabel = document.createElement("span");
    httpsLabel.textContent = t("Public HTTPS address");
    httpsRow.append(httpsLabel, httpsInput);

    const enrollmentInput = document.createElement("input");
    enrollmentInput.type = "url";
    enrollmentInput.spellcheck = false;
    enrollmentInput.autocomplete = "off";
    enrollmentInput.value = status.publicEnrollmentUrl || "";
    enrollmentInput.placeholder = "http://www.zicode.com:39011";
    const enrollmentRow = document.createElement("label");
    enrollmentRow.className = "settings-field";
    const enrollmentLabel = document.createElement("span");
    enrollmentLabel.textContent = t("Public certificate setup address");
    enrollmentRow.append(enrollmentLabel, enrollmentInput);
    publicFields.append(httpsRow, enrollmentRow);

    const publicSaveRow = document.createElement("div");
    publicSaveRow.className = "remote-access-public-save";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "ui-button ui-button--secondary ui-button--sm";
    saveButton.textContent = t("Save");
    const saveStatus = document.createElement("span");
    saveStatus.className = "settings-help";
    saveStatus.setAttribute("role", "status");
    const restartHint = document.createElement("small");
    restartHint.className = "settings-help";
    restartHint.textContent = t("Public tunnel addresses take effect after restart.");
    saveButton.addEventListener("click", async () => {
      if (updating) return;
      updating = true;
      saveButton.disabled = true;
      saveStatus.textContent = "";
      const httpsUrl = httpsInput.value.trim();
      const enrollmentUrl = enrollmentInput.value.trim();
      if (httpsUrl && !/^https?:\/\//.test(httpsUrl)) {
        saveStatus.textContent = t("Invalid public address");
        updating = false;
        saveButton.disabled = false;
        return;
      }
      if (enrollmentUrl && !/^https?:\/\//.test(enrollmentUrl)) {
        saveStatus.textContent = t("Invalid public address");
        updating = false;
        saveButton.disabled = false;
        return;
      }
      try {
        await gateway.setPublic(httpsUrl, enrollmentUrl);
        saveStatus.textContent = t("Saved");
        await load();
      } catch (error) {
        saveStatus.textContent = `${t("Invalid public address")}: ${error?.message || ""}`;
      } finally {
        updating = false;
        saveButton.disabled = false;
      }
    });
    publicSaveRow.append(saveButton, saveStatus, restartHint);
    publicSection.append(publicTitle, publicHelp, publicFields, publicSaveRow);

    const relaySection = document.createElement("section");
    relaySection.className = "settings-section remote-access-relay";
    const relayTitleRow = document.createElement("div");
    relayTitleRow.className = "settings-section-title remote-access-title-row";
    const relayTitle = document.createElement("span");
    relayTitle.textContent = t("Relay access");
    const relayBadge = document.createElement("span");
    relayBadge.className = `ui-badge ${status.relayEnabled ? "remote-access-on-badge" : "remote-access-off-badge"}`;
    relayBadge.textContent = t(status.relayEnabled ? "On" : "Off");
    const relayToggle = document.createElement("button");
    relayToggle.type = "button";
    relayToggle.className = `settings-toggle${status.relayEnabled ? " on" : ""}`;
    relayToggle.setAttribute("role", "switch");
    relayToggle.setAttribute("aria-checked", String(Boolean(status.relayEnabled)));
    relayToggle.setAttribute("aria-label", t("Route remote access through the server relay"));
    relayToggle.disabled = updating || !gateway;
    relayTitleRow.append(relayTitle, relayBadge, relayToggle);
    const relayHelp = document.createElement("p");
    relayHelp.className = "settings-help";
    relayHelp.textContent = t(
      "Desktop and phone both dial the rendezvous server, so this computer needs no inbound ports or tunnels. Applies when secure mobile access is on.",
    );
    const relayLive = document.createElement("p");
    relayLive.className = "settings-help remote-access-relay-live";
    relayLive.setAttribute("role", "status");
    if (status.relayEnabled) {
      if (status.relayConnected) {
        relayLive.dataset.relayState = "connected";
        const connectedAt = status.relayConnectedAt
          ? ` · ${formatTime(status.relayConnectedAt)}`
          : "";
        relayLive.textContent = `${t("Relay connected")}${connectedAt}`;
      } else {
        relayLive.dataset.relayState = "disconnected";
        relayLive.textContent = status.relayLastError
          ? `${t("Relay disconnected")}: ${status.relayLastError}`
          : t("Relay connecting…");
      }
    }
    const relayUsage = document.createElement("p");
    relayUsage.className = "settings-help remote-access-relay-usage";
    relayUsage.textContent =
      status.relayUsageBytes == null
        ? ""
        : `${t("Relay traffic today")}: ${formatBytes(status.relayUsageBytes)}`;

    const relayHistory = document.createElement("div");
    relayHistory.className = "remote-access-relay-history";
    const history = Array.isArray(status.relayUsageHistory)
      ? status.relayUsageHistory.filter((entry) => Number.isFinite(Number(entry?.day)))
      : [];
    const recentHistory = history.slice(-7).reverse();
    if (recentHistory.length > 0) {
      const historyTitle = document.createElement("strong");
      historyTitle.textContent = t("Relay traffic history");
      const historyList = document.createElement("ul");
      historyList.setAttribute("aria-label", t("Relay traffic history"));
      for (const entry of recentHistory) {
        const row = document.createElement("li");
        const when = document.createElement("span");
        when.textContent = new Intl.DateTimeFormat(getLocale(), {
          month: "short",
          day: "numeric",
        }).format(new Date(Number(entry.day) * 86_400_000));
        const amount = document.createElement("strong");
        amount.textContent = formatBytes(entry.bytes);
        row.append(when, amount);
        historyList.append(row);
      }
      relayHistory.append(historyTitle, historyList);
    }

    const relayFields = document.createElement("div");
    relayFields.className = "remote-access-relay-fields";
    const relayUrlInput = document.createElement("input");
    relayUrlInput.type = "url";
    relayUrlInput.spellcheck = false;
    relayUrlInput.autocomplete = "off";
    relayUrlInput.value = status.relayUrl || "";
    relayUrlInput.placeholder = "wss://relay.zicode.com";
    const relayUrlRow = document.createElement("label");
    relayUrlRow.className = "settings-field";
    const relayUrlLabel = document.createElement("span");
    relayUrlLabel.textContent = t("Relay server address");
    relayUrlRow.append(relayUrlLabel, relayUrlInput);
    relayFields.append(relayUrlRow);

    if (status.relayDeviceId) {
      const deviceIdRow = document.createElement("div");
      deviceIdRow.className = "remote-access-relay-device";
      const deviceIdLabel = document.createElement("span");
      deviceIdLabel.textContent = t("Device ID");
      const deviceIdValue = document.createElement("code");
      deviceIdValue.textContent = status.relayDeviceId;
      deviceIdRow.append(deviceIdLabel, deviceIdValue);
      relayFields.append(deviceIdRow);
    }
    if (status.e2eeFingerprint) {
      const e2eeRow = document.createElement("div");
      e2eeRow.className = "remote-access-relay-device";
      const e2eeLabel = document.createElement("span");
      e2eeLabel.textContent = t("E2EE identity");
      const e2eeValue = document.createElement("code");
      e2eeValue.textContent = status.e2eeFingerprint;
      e2eeRow.append(e2eeLabel, e2eeValue);
      relayFields.append(e2eeRow);
    }

    const relaySaveRow = document.createElement("div");
    relaySaveRow.className = "remote-access-relay-save";
    const relaySave = document.createElement("button");
    relaySave.type = "button";
    relaySave.className = "ui-button ui-button--secondary ui-button--sm";
    relaySave.textContent = t("Save");
    const relayStatus = document.createElement("span");
    relayStatus.className = "settings-help";
    relayStatus.setAttribute("role", "status");
    relayStatus.textContent = relayError;
    const relayRestartHint = document.createElement("small");
    relayRestartHint.className = "settings-help";
    relayRestartHint.textContent = t("Relay changes take effect after restart.");
    relaySaveRow.append(relaySave, relayStatus, relayRestartHint);
    relayFields.append(relaySaveRow);
    relaySection.append(
      relayTitleRow,
      relayHelp,
      relayLive,
      relayUsage,
      relayHistory,
      relayFields,
    );

    const saveRelay = async (enabled) => {
      if (updating) return;
      const relayUrl = relayUrlInput.value.trim();
      if (enabled && !relayUrl) {
        relayStatus.textContent = t(
          "Relay server address is required when relay access is enabled.",
        );
        return;
      }
      if (relayUrl && !/^wss?:\/\//.test(relayUrl)) {
        relayStatus.textContent = t("Invalid relay address");
        return;
      }
      if (enabled && !status.publicUrl) {
        relayStatus.textContent = t(
          "Set the public HTTPS address first; relay access requires it.",
        );
        return;
      }
      relayError = "";
      updating = true;
      render();
      try {
        status = await gateway.setRelay(enabled, relayUrl);
        updating = false;
        render();
      } catch (error) {
        relayError = `${t("Invalid relay address")}: ${error?.message || ""}`;
        updating = false;
        render();
      }
    };
    relayToggle.addEventListener("click", () => void saveRelay(!status.relayEnabled));
    relaySave.addEventListener("click", () => void saveRelay(status.relayEnabled));

    const deviceSection = document.createElement("section");
    deviceSection.className = "settings-section";
    const deviceTitleRow = document.createElement("div");
    deviceTitleRow.className = "settings-section-title remote-access-title-row";
    const deviceTitle = document.createElement("span");
    deviceTitle.textContent = t("Paired devices");
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "ui-button ui-button--secondary ui-button--sm";
    refresh.textContent = t("Refresh");
    refresh.addEventListener("click", () => void load());
    deviceTitleRow.append(deviceTitle, refresh);
    const help = document.createElement("p");
    help.className = "settings-help";
    help.textContent = t(
      "Revoking a device invalidates its token and closes an active connection within a few seconds. A new desktop-generated pairing link is required to reconnect.",
    );
    const list = document.createElement("div");
    list.className = "remote-device-list";
    list.dataset.remoteDeviceList = "";
    list.setAttribute("aria-live", "polite");
    if (loading) {
      list.setAttribute("aria-busy", "true");
      const loadingState = document.createElement("p");
      loadingState.className = "remote-access-state";
      loadingState.textContent = t("Loading paired devices…");
      list.append(loadingState);
    } else if (devices.length === 0) {
      const empty = document.createElement("p");
      empty.className = "remote-access-state";
      empty.textContent = t("No mobile devices have been paired.");
      list.append(empty);
    } else {
      list.append(...devices.map(deviceRow));
    }
    deviceSection.append(deviceTitleRow, help, list);
    body.append(overview, publicSection, relaySection, deviceSection);
    root.append(body);
  }

  async function load() {
    if (loading) return;
    loading = true;
    render();
    try {
      if (!gateway) throw new Error(t("Remote access controls are unavailable."));
      [status, devices] = await Promise.all([gateway.getStatus(), gateway.listDevices()]);
      loading = false;
      render();
    } catch (error) {
      loading = false;
      render();
      renderError(error);
    }
  }

  render();
  window.addEventListener("zicode:locale-changed", render);
  const refreshWhenVisible = () => {
    if (document.visibilityState === "visible") void load();
  };
  window.addEventListener("focus", refreshWhenVisible);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  return { load };
}
