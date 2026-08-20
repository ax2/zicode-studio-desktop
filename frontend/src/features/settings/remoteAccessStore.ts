import { create } from "zustand";
import { getLocale, t } from "../../shared/i18n";

export interface RemoteDevice {
  deviceId?: string;
  deviceName?: string;
  pairedAt?: number;
  lastSeenAt?: number;
  revokedAt?: number;
}

export interface RemoteAccessStatus {
  configuredEnabled?: boolean;
  running?: boolean;
  restartRequired?: boolean;
  urls?: string[];
  enrollmentUrls?: string[];
  caFingerprint?: string;
  publicUrl?: string;
  publicEnrollmentUrl?: string;
  relayEnabled?: boolean;
  relayConnected?: boolean;
  relayConnectedAt?: number;
  relayLastError?: string;
  relayUsageBytes?: number;
  relayUsageHistory?: Array<{ day?: number; bytes?: number }>;
  relayUrl?: string;
  relayDeviceId?: string;
  e2eeFingerprint?: string;
  relayTurnUrl?: string;
  relayTurnRealm?: string;
}

export interface RemoteAccessGateway {
  getStatus(): Promise<RemoteAccessStatus>;
  listDevices(): Promise<RemoteDevice[]>;
  setEnabled(enabled: boolean): Promise<RemoteAccessStatus>;
  setPublic(httpsUrl: string, enrollmentUrl: string): Promise<unknown>;
  setRelay(enabled: boolean, relayUrl: string): Promise<RemoteAccessStatus>;
  updateRelayTurn(url: string, realm: string, secret: string): Promise<unknown>;
  probeTurn(): Promise<{ result: string; detail?: string }>;
  revokeDevice(deviceId: string): Promise<unknown>;
}

export type TurnProbeStatus =
  | "idle"
  | "busy"
  | "ok"
  | "unauthenticated"
  | "unreachable"
  | "protocol"
  | "unconfigured"
  | "error";

interface RemoteAccessState {
  status: RemoteAccessStatus;
  devices: RemoteDevice[];
  loading: boolean;
  updating: boolean;
  relayError: string;
  publicUrlInput: string;
  publicEnrollmentInput: string;
  publicSaveStatus: string;
  relayUrlInput: string;
  turnUrlInput: string;
  turnRealmInput: string;
  turnSecretInput: string;
  turnSaveStatus: string;
  turnProbeStatus: TurnProbeStatus;
  turnProbeDetail: string;
  relaySaveStatus: string;
  loadError: string | null;
  load(options?: { quiet?: boolean }): Promise<void>;
  toggleEnabled(): Promise<void>;
  savePublic(): Promise<void>;
  setPublicInputs(publicUrl: string, publicEnrollment: string): void;
  saveRelay(enabled: boolean): Promise<void>;
  setRelayUrlInput(value: string): void;
  setTurnInputs(url: string, realm: string, secret: string): void;
  saveTurn(): Promise<void>;
  runTurnProbe(): Promise<void>;
  revokeDevice(deviceId: string): Promise<void>;
}

export function createRemoteAccessStore(gateway: RemoteAccessGateway | null) {
  const seed = (status: RemoteAccessStatus) => ({
    publicUrlInput: status.publicUrl || "",
    publicEnrollmentInput: status.publicEnrollmentUrl || "",
    relayUrlInput: status.relayUrl || "",
    turnUrlInput: status.relayTurnUrl || "",
    turnRealmInput: status.relayTurnRealm || "",
    turnSecretInput: "",
  });

  return create<RemoteAccessState>()((set, get) => ({
    status: {},
    devices: [],
    loading: false,
    updating: false,
    relayError: "",
    publicUrlInput: "",
    publicEnrollmentInput: "",
    publicSaveStatus: "",
    relayUrlInput: "",
    turnUrlInput: "",
    turnRealmInput: "",
    turnSecretInput: "",
    turnSaveStatus: "",
    turnProbeStatus: "idle",
    turnProbeDetail: "",
    relaySaveStatus: "",
    loadError: null,

    async load({ quiet = false } = {}) {
      if (get().loading) return;
      if (!quiet) set({ loading: true });
      try {
        if (!gateway) throw new Error(t("Remote access controls are unavailable."));
        const [status, devices] = await Promise.all([
          gateway.getStatus(),
          gateway.listDevices(),
        ]);
        set({ status, devices, loading: false, ...seed(status) });
      } catch (error) {
        set({
          loading: false,
          devices: [],
          loadError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async toggleEnabled() {
      if (get().updating || !gateway) return;
      set({ updating: true });
      try {
        const status = await gateway.setEnabled(!get().status.configuredEnabled);
        set({ status, updating: false });
      } catch (error) {
        set({
          updating: false,
          loadError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    setPublicInputs(publicUrl, publicEnrollment) {
      set({ publicUrlInput: publicUrl, publicEnrollmentInput: publicEnrollment, publicSaveStatus: "" });
    },

    async savePublic() {
      if (get().updating || !gateway) return;
      set({ updating: true, publicSaveStatus: "" });
      const httpsUrl = get().publicUrlInput.trim();
      const enrollmentUrl = get().publicEnrollmentInput.trim();
      if (httpsUrl && !/^https?:\/\//.test(httpsUrl)) {
        set({ updating: false, publicSaveStatus: t("Invalid public address") });
        return;
      }
      if (enrollmentUrl && !/^https?:\/\//.test(enrollmentUrl)) {
        set({ updating: false, publicSaveStatus: t("Invalid public address") });
        return;
      }
      try {
        await gateway.setPublic(httpsUrl, enrollmentUrl);
        set({ publicSaveStatus: t("Saved") });
        await get().load();
      } catch (error) {
        set({
          publicSaveStatus: `${t("Invalid public address")}: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        set({ updating: false });
      }
    },

    setRelayUrlInput(value) {
      set({ relayUrlInput: value, relaySaveStatus: "" });
    },

    async saveRelay(enabled) {
      if (get().updating || !gateway) return;
      const relayUrl = get().relayUrlInput.trim();
      const status = get().status;
      if (enabled && !relayUrl) {
        set({ relaySaveStatus: t("Relay server address is required when relay access is enabled.") });
        return;
      }
      if (relayUrl && !/^wss?:\/\//.test(relayUrl)) {
        set({ relaySaveStatus: t("Invalid relay address") });
        return;
      }
      if (enabled && !status.publicUrl) {
        set({ relaySaveStatus: t("Set the public HTTPS address first; relay access requires it.") });
        return;
      }
      set({ updating: true, relayError: "" });
      try {
        const next = await gateway.setRelay(enabled, relayUrl);
        set({ status: next, updating: false, ...seed(next) });
      } catch (error) {
        set({
          updating: false,
          relayError: `${t("Invalid relay address")}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },

    setTurnInputs(url, realm, secret) {
      set({ turnUrlInput: url, turnRealmInput: realm, turnSecretInput: secret, turnSaveStatus: "" });
    },

    async saveTurn() {
      if (get().updating || !gateway) return;
      set({ updating: true, turnSaveStatus: "" });
      try {
        await gateway.updateRelayTurn(
          get().turnUrlInput.trim(),
          get().turnRealmInput.trim(),
          get().turnSecretInput.trim(),
        );
        set({ turnSaveStatus: t("Saved"), turnSecretInput: "" });
        await get().load();
      } catch (error) {
        set({
          turnSaveStatus: `${t("Save failed")}: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        set({ updating: false });
      }
    },

    async runTurnProbe() {
      if (get().turnProbeStatus === "busy" || !gateway) return;
      set({ turnProbeStatus: "busy", turnProbeDetail: "" });
      try {
        const probe = await gateway.probeTurn();
        const result = probe?.result;
        const known: TurnProbeStatus[] = [
          "ok",
          "unauthenticated",
          "unreachable",
          "protocol",
          "unconfigured",
        ];
        set({
          turnProbeStatus: known.includes(result as TurnProbeStatus)
            ? (result as TurnProbeStatus)
            : "error",
          turnProbeDetail: probe?.detail || "",
        });
      } catch (error) {
        set({
          turnProbeStatus: "error",
          turnProbeDetail: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async revokeDevice(deviceId) {
      if (!gateway) return;
      try {
        await gateway.revokeDevice(deviceId);
        await get().load();
      } catch (error) {
        set({ loadError: error instanceof Error ? error.message : String(error) });
      }
    },
  }));
}

export type RemoteAccessStore = ReturnType<typeof createRemoteAccessStore>;

export function formatBytes(bytes: unknown): string {
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

export function formatRemoteTime(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return t("Never");
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(seconds * 1000));
}
