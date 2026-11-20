export function SettingsToggle({
  id,
  enabled,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  id: string;
  enabled: boolean;
  onChange(): void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      id={id}
      className={`settings-toggle${enabled ? " on" : ""}`}
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
    ></button>
  );
}

