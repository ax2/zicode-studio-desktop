import { t } from "../../shared/i18n";

export type LanQrKind = "session" | "setup";

export function expiryText(
  expiresAt: number | null | undefined,
  nowSeconds = Date.now() / 1000,
): { text: string; expired: boolean } {
  if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) <= 0) {
    return { text: "", expired: false };
  }
  const seconds = Math.max(0, Math.ceil(Number(expiresAt) - nowSeconds));
  if (seconds === 0) {
    return { text: t("This QR code expired. Refresh to create a new one."), expired: true };
  }
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return {
    text: t("One-time link expires in {time}").replace("{time}", `${minutes}:${remainder}`),
    expired: false,
  };
}

export function fingerprintLines(fingerprint: string | null | undefined): string[] {
  const groups = String(fingerprint || t("Unavailable")).split(":");
  const lines: string[] = [];
  for (let index = 0; index < groups.length; index += 8) {
    lines.push(groups.slice(index, index + 8).join(":"));
  }
  return lines;
}

export function hintKey(kind: LanQrKind): string {
  return kind === "setup"
    ? "First-time phone: scan to install and trust the local certificate."
    : "Already trusted this computer? Scan to pair and open the current chat.";
}

export function imageAltKey(kind: LanQrKind): string {
  return kind === "setup"
    ? "QR code for phone certificate setup"
    : "QR code for current chat";
}
