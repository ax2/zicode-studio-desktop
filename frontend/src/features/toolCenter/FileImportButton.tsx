import { useRef } from "react";
import { t } from "../../shared/i18n";

export function FileImportButton({ label, inputLabel, disabled, loading, accept = ".csv,.tsv,.json", loadingLabel = "Reading table file…", onPick }: {
  label: string; inputLabel: string; disabled: boolean; loading: boolean; accept?: string; loadingLabel?: string; onPick(file: File): void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return <>
    <input ref={picker} type="file" hidden accept={accept} aria-label={inputLabel} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) onPick(file);
    }} />
    <button type="button" className="ui-button ui-button--secondary" disabled={disabled}
      onClick={() => picker.current?.click()}>{loading ? t(loadingLabel) : label}</button>
  </>;
}
