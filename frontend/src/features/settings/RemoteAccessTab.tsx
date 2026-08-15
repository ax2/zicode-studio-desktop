import { useEffect, useRef, useState } from "react";
import { getLocale, t } from "../../shared/i18n";
import {
  formatBytes,
  formatRemoteTime,
  type RemoteAccessStore,
  type RemoteDevice,
  type TurnProbeStatus,
} from "./remoteAccessStore";

export function turnProbeMessage(
  status: TurnProbeStatus,
  detail: string,
): string {
  switch (status) {
    case "ok":
      return t(
        "TURN connection OK — credentials match the server.",
      );
    case "unauthenticated":
      return t(
        "TURN server rejected the derived credential — check that the desktop secret matches the coturn static-auth-secret.",
      );
    case "unreachable":
      return detail
        ? `${t("TURN server unreachable")}: ${detail}`
        : t("TURN server unreachable");
    case "protocol":
      return detail
        ? `${t("TURN protocol error")}: ${detail}`
        : t("TURN protocol error");
    case "unconfigured":
      return t(
        "Configure the TURN server address, realm and secret first.",
      );
    case "error":
      return detail
        ? `${t("TURN test failed")}: ${detail}`
        : t("TURN test failed");
    default:
      return "";
  }
}

export function RemoteAccessTab({ store }: { store: RemoteAccessStore }) {
  const load = store((state) => state.load);

  useEffect(() => {
    void load();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  return (
    <div className="settings-body remote-access-settings">
      <OverviewSection store={store} />
      <PublicSection store={store} />
      <RelaySection store={store} />
      <PairedDevicesSection store={store} />
    </div>
  );
}

function OverviewSection({ store }: { store: RemoteAccessStore }) {
  const status = store((state) => state.status);
  const loading = store((state) => state.loading);
  const updating = store((state) => state.updating);
  const gatewayAvailable = store((state) => state.loadError === null || state.loadError === "");
  const toggleEnabled = store((state) => state.toggleEnabled);
  const badgeText = status.restartRequired
    ? t("Restart required")
    : status.running
      ? t("On")
      : t("Off");
  return (
    <section className="settings-section remote-access-overview">
      <div className="settings-section-title remote-access-title-row">
        <span>{t("Secure mobile access")}</span>
        <div className="remote-access-title-controls">
          <span
            className={`ui-badge ${status.running ? "remote-access-on-badge" : "remote-access-off-badge"}`}
          >
            {badgeText}
          </span>
          <button
            type="button"
            className={`settings-toggle${status.configuredEnabled ? " on" : ""}`}
            role="switch"
            aria-checked={Boolean(status.configuredEnabled)}
            aria-label={t("Allow secure access from this local network")}
            disabled={loading || updating || !gatewayAvailable}
            onClick={() => void toggleEnabled()}
          ></button>
        </div>
      </div>
      <p className="settings-help">
        {t(
          "Remote access uses HTTPS/WSS and remains off until you enable it. Restart ZiCode Studio after changing this switch.",
        )}
      </p>
      <div className="remote-access-readiness" role="status">
        {status.running ? (
          <>
            <strong>{t("Secure addresses")}</strong>
            <div className="remote-access-addresses">
              {(status.urls ?? []).map((url) => (
                <code key={url}>{url}</code>
              ))}
            </div>
            <strong>{t("Phone trust setup")}</strong>
            <code>{status.enrollmentUrls?.[0] ?? t("Unavailable")}</code>
            <p className="remote-access-fingerprint">
              {t("CA fingerprint")}: {status.caFingerprint || t("Unavailable")}
            </p>
            <a
            className="ui-button ui-button--secondary ui-button--sm remote-access-ca-link"
              href={status.enrollmentUrls?.[0] ?? ""}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("Open certificate setup")}
            </a>
          </>
        ) : (
          t(
            status.restartRequired
              ? "Restart ZiCode Studio to apply this remote access change."
              : "Only this computer can connect while secure mobile access is off.",
          )
        )}
      </div>
    </section>
  );
}

function PublicSection({ store }: { store: RemoteAccessStore }) {
  const publicUrlInput = store((state) => state.publicUrlInput);
  const publicEnrollmentInput = store((state) => state.publicEnrollmentInput);
  const publicSaveStatus = store((state) => state.publicSaveStatus);
  const updating = store((state) => state.updating);
  const setInputs = store((state) => state.setPublicInputs);
  const savePublic = store((state) => state.savePublic);
  return (
    <section className="settings-section remote-access-public">
      <h3 className="settings-section-title">{t("Public internet access")}</h3>
      <p className="settings-help">{t("Leave empty to disable public access.")}</p>
      <div className="remote-access-public-fields">
        <label className="settings-field">
          <span>{t("Public HTTPS address")}</span>
          <input
            type="url"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            value={publicUrlInput}
            placeholder="https://www.zicode.com:39010"
            onChange={(event) => setInputs(event.target.value, publicEnrollmentInput)}
          />
        </label>
        <label className="settings-field">
          <span>{t("Public certificate setup address")}</span>
          <input
            type="url"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            value={publicEnrollmentInput}
            placeholder="http://www.zicode.com:39011"
            onChange={(event) => setInputs(publicUrlInput, event.target.value)}
          />
        </label>
      </div>
      <div className="remote-access-public-save">
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={updating}
          onClick={() => void savePublic()}
        >
          {t("Save")}
        </button>
        <span className="settings-help" role="status">
          {publicSaveStatus}
        </span>
        <small className="settings-help">
          {t("Public tunnel addresses take effect after restart.")}
        </small>
      </div>
    </section>
  );
}

function RelaySection({ store }: { store: RemoteAccessStore }) {
  const status = store((state) => state.status);
  const updating = store((state) => state.updating);
  const relayError = store((state) => state.relayError);
  const relayUrlInput = store((state) => state.relayUrlInput);
  const turnUrlInput = store((state) => state.turnUrlInput);
  const turnRealmInput = store((state) => state.turnRealmInput);
  const turnSecretInput = store((state) => state.turnSecretInput);
  const turnSaveStatus = store((state) => state.turnSaveStatus);
  const turnProbeStatus = store((state) => state.turnProbeStatus);
  const turnProbeDetail = store((state) => state.turnProbeDetail);
  const relaySaveStatus = store((state) => state.relaySaveStatus);
  const setRelayUrlInput = store((state) => state.setRelayUrlInput);
  const setTurnInputs = store((state) => state.setTurnInputs);
  const saveRelay = store((state) => state.saveRelay);
  const saveTurn = store((state) => state.saveTurn);
  const runTurnProbe = store((state) => state.runTurnProbe);

  const history = Array.isArray(status.relayUsageHistory)
    ? status.relayUsageHistory.filter((entry) => Number.isFinite(Number(entry?.day)))
    : [];
  const recentHistory = history.slice(-7).reverse();

  return (
    <section className="settings-section remote-access-relay">
      <div className="settings-section-title remote-access-title-row">
        <span>{t("Relay access")}</span>
        <span
          className={`ui-badge ${status.relayEnabled ? "remote-access-on-badge" : "remote-access-off-badge"}`}
        >
          {t(status.relayEnabled ? "On" : "Off")}
        </span>
        <button
          type="button"
          className={`settings-toggle${status.relayEnabled ? " on" : ""}`}
          role="switch"
          aria-checked={Boolean(status.relayEnabled)}
          aria-label={t("Route remote access through the server relay")}
          disabled={updating}
          onClick={() => void saveRelay(!status.relayEnabled)}
        ></button>
      </div>
      <p className="settings-help">
        {t(
          "Desktop and phone both dial the rendezvous server, so this computer needs no inbound ports or tunnels. Applies when secure mobile access is on.",
        )}
      </p>
      <p
        className="settings-help remote-access-relay-live"
        role="status"
        data-relay-state={status.relayEnabled ? (status.relayConnected ? "connected" : "disconnected") : undefined}
      >
        {status.relayEnabled
          ? status.relayConnected
            ? `${t("Relay connected")}${status.relayConnectedAt ? ` · ${formatRemoteTime(status.relayConnectedAt)}` : ""}`
            : status.relayLastError
              ? `${t("Relay disconnected")}: ${status.relayLastError}`
              : t("Relay connecting…")
          : ""}
      </p>
      <p className="settings-help remote-access-relay-usage">
        {status.relayUsageBytes == null
          ? ""
          : `${t("Relay traffic today")}: ${formatBytes(status.relayUsageBytes)}`}
      </p>
      {recentHistory.length > 0 ? (
        <div className="remote-access-relay-history">
          <strong>{t("Relay traffic history")}</strong>
          <ul aria-label={t("Relay traffic history")}>
            {recentHistory.map((entry) => (
              <li key={String(entry.day)}>
                <span>
                  {new Intl.DateTimeFormat(getLocale(), {
                    month: "short",
                    day: "numeric",
                  }).format(new Date(Number(entry.day) * 86_400_000))}
                </span>
                <strong>{formatBytes(entry.bytes)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="remote-access-relay-fields">
        <label className="settings-field">
          <span>{t("Relay server address")}</span>
          <input
            type="url"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            value={relayUrlInput}
            placeholder="wss://relay.zicode.com"
            onChange={(event) => setRelayUrlInput(event.target.value)}
          />
        </label>
        {status.relayDeviceId ? (
          <div className="remote-access-relay-device">
            <span>{t("Device ID")}</span>
            <code>{status.relayDeviceId}</code>
          </div>
        ) : null}
        {status.e2eeFingerprint ? (
          <div className="remote-access-relay-device">
            <span>{t("E2EE identity")}</span>
            <code>{status.e2eeFingerprint}</code>
          </div>
        ) : null}
        <strong>{t("TURN relay (optional)")}</strong>
        <p className="settings-help">
          {t(
            "STUN/TURN servers let the phone punch through NAT for direct P2P. The desktop auto-derives short-lived TURN credentials.",
          )}
        </p>
        <form
          className="remote-access-turn-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveTurn();
          }}
        >
          <label className="settings-field">
            <span>{t("TURN server address")}</span>
            <input
              type="url"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              value={turnUrlInput}
              placeholder="turn:turn.remote.zicode.com:3478?transport=udp"
              onChange={(event) => setTurnInputs(event.target.value, turnRealmInput, turnSecretInput)}
            />
          </label>
          <label className="settings-field">
            <span>{t("TURN realm")}</span>
            <input
              type="text"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              value={turnRealmInput}
              placeholder="turn.remote.zicode.com"
              onChange={(event) => setTurnInputs(turnUrlInput, event.target.value, turnSecretInput)}
            />
          </label>
          <label className="settings-field">
            <span>{t("TURN secret")}</span>
            <input
              type="password"
              spellCheck={false}
              autoComplete="off"
              value={turnSecretInput}
              placeholder="••••••••••••"
              onChange={(event) => setTurnInputs(turnUrlInput, turnRealmInput, event.target.value)}
            />
          </label>
          <div className="remote-access-relay-save remote-access-relay-turn-save">
            <button
              type="submit"
              className="ui-button ui-button--secondary ui-button--sm"
              disabled={updating}
            >
              {t("Save")}
            </button>
            <span className="settings-help" role="status">
              {turnSaveStatus}
            </span>
          </div>
          <div className="remote-access-relay-save remote-access-turn-probe">
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              disabled={updating || turnProbeStatus === "busy"}
              aria-busy={turnProbeStatus === "busy"}
              onClick={() => void runTurnProbe()}
            >
              {turnProbeStatus === "busy"
                ? t("Testing TURN connection…")
                : t("Test TURN connection")}
            </button>
            <span
              className="settings-help"
              role="status"
              data-turn-probe-status={turnProbeStatus}
            >
              {turnProbeMessage(turnProbeStatus, turnProbeDetail)}
            </span>
          </div>
        </form>
        <div className="remote-access-relay-save remote-access-relay-config-save">
          <button
            type="button"
            className="ui-button ui-button--secondary ui-button--sm"
            disabled={updating}
            onClick={() => void saveRelay(Boolean(status.relayEnabled))}
          >
            {t("Save")}
          </button>
          <span className="settings-help" role="status">
            {relayError || relaySaveStatus}
          </span>
          <small className="settings-help">
            {t("Relay changes take effect after restart.")}
          </small>
        </div>
      </div>
    </section>
  );
}

function PairedDevicesSection({ store }: { store: RemoteAccessStore }) {
  const devices = store((state) => state.devices);
  const loading = store((state) => state.loading);
  const loadError = store((state) => state.loadError);
  const load = store((state) => state.load);
  return (
    <section className="settings-section">
      <div className="settings-section-title remote-access-title-row">
        <span>{t("Paired devices")}</span>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          onClick={() => void load()}
        >
          {t("Refresh")}
        </button>
      </div>
      <p className="settings-help">
        {t(
          "Revoking a device invalidates its token and closes an active connection within a few seconds. A new desktop-generated pairing link is required to reconnect.",
        )}
      </p>
      <div className="remote-device-list" data-remote-device-list="" aria-live="polite">
        {loadError ? (
          <div className="remote-access-state remote-access-error" role="alert">
            <p>{t("Could not load paired devices.")}</p>
            <p className="settings-help">{loadError}</p>
            <button
              type="button"
              className="ui-button ui-button--secondary"
              onClick={() => void load()}
            >
              {t("Retry")}
            </button>
          </div>
        ) : loading ? (
          <p className="remote-access-state">{t("Loading paired devices…")}</p>
        ) : devices.length === 0 ? (
          <p className="remote-access-state">{t("No mobile devices have been paired.")}</p>
        ) : (
          devices.map((device) => <DeviceRow key={device.deviceId} store={store} device={device} />)
        )}
      </div>
    </section>
  );
}

function DeviceRow({ store, device }: { store: RemoteAccessStore; device: RemoteDevice }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const revoke = store((state) => state.revokeDevice);
  const now = Date.now();
  const online =
    !device.revokedAt &&
    Number(device.lastSeenAt) > 0 &&
    now / 1000 - Number(device.lastSeenAt) < 90;
  const name = device.deviceName || t("Mobile device");
  return (
    <article className="ui-card remote-device-card" data-device-id={device.deviceId}>
      <div className="remote-device-heading">
        <strong className="remote-device-name">{name}</strong>
        <span
          className={`ui-badge remote-device-status ${device.revokedAt ? "is-revoked" : online ? "is-online" : "is-offline"}`}
        >
          {t(device.revokedAt ? "Revoked" : online ? "Online" : "Offline")}
        </span>
      </div>
      <dl className="remote-device-metadata">
        <dt>{t("Paired on")}</dt>
        <dd>{formatRemoteTime(device.pairedAt)}</dd>
        <dt>{t("Last active")}</dt>
        <dd>{formatRemoteTime(device.lastSeenAt)}</dd>
      </dl>
      {!device.revokedAt ? (
        <button
          type="button"
          className="ui-button ui-button--danger ui-button--sm remote-device-revoke"
          aria-label={armed ? t("Confirm revoke access for {device}").replace("{device}", name) : undefined}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              timer.current = globalThis.setTimeout(() => setArmed(false), 5_000);
              return;
            }
            if (timer.current) globalThis.clearTimeout(timer.current);
            void revoke(device.deviceId || "");
          }}
        >
          {t(armed ? "Confirm revoke" : "Revoke access")}
        </button>
      ) : null}
    </article>
  );
}
