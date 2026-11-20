import { t } from "../../shared/i18n";

const referenceMessages = {
  reference_not_authorized: "Source needs authorization.",
  reference_volume_offline: "Source drive is offline.",
  reference_source_missing: "Source file or folder is missing.",
  reference_identity_changed: "Source file or folder was replaced.",
  reference_content_changed: "Source image content has changed.",
  reference_path_rejected: "Choose files inside the selected source folder.",
  reference_file_rejected: "The source file is unavailable or exceeds the image limit.",
  reference_source_unavailable: "The source image could not be opened.",
} as const;

export function referenceMessage(reason: unknown, fallback: string): string {
  const code = String(reason);
  const match = Object.entries(referenceMessages).find(([key]) => code.includes(key));
  return match?.[1] ?? fallback;
}

export function ReferenceSource({
  name,
  archived,
  disabled,
  onReconnect,
}: {
  name: string;
  archived?: boolean;
  disabled: boolean;
  onReconnect: () => void;
}) {
  if (archived) return <span className="ui-badge">{t("Archived original")}</span>;
  return (
    <div className="ui-toolbar">
      <span className="ui-badge">{t("Referenced original")}</span>
      <button
        type="button"
        className="ui-button ui-button--sm"
        aria-label={t("Reconnect source for {name}").replace("{name}", () => name)}
        title={t("Choose a source folder that preserves the original folder layout.")}
        disabled={disabled}
        onClick={onReconnect}
      >
        {t("Reconnect source")}
      </button>
    </div>
  );
}
