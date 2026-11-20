import { useCallback, useEffect } from "react";
import { t } from "../../shared/i18n";
import { type CharacterRequest, type RecordPage, useCharacterRecords } from "./useCharacterRecords";

export type Binding = "identityVersion" | "appearanceVersion" | "styleVersion" | "referenceSetId";

const labels = {
  identityVersion: "Identity version",
  appearanceVersion: "Appearance version",
  styleVersion: "Style version",
  referenceSetId: "Approved reference set",
} as const;

const facets = {
  identityVersion: "identity",
  appearanceVersion: "appearance",
  styleVersion: "style",
} as const;

type Choice = { id: number; label: string; text?: string };

export function RecipeInputPicker({
  id,
  binding,
  value,
  disabled,
  request,
  onChange,
}: {
  id: string;
  binding: Binding;
  value: number | null;
  disabled: boolean;
  request: CharacterRequest;
  onChange: (value: number | null) => void;
}) {
  const read = useCallback(
    async (before?: number): Promise<RecordPage<Choice, number>> => {
      if (binding === "referenceSetId") {
        const page = (await request({ kind: "referenceSets", id, before })) as RecordPage<
          { id: number; name: string },
          number
        >;
        return {
          entries: page.entries.map((set) => ({ id: set.id, label: `${set.name} · ${set.id}` })),
          next: page.next,
        };
      }
      const page = (await request({
        kind: "revisions",
        id,
        facet: facets[binding],
        before,
      })) as RecordPage<{ version: number; text: string }, number>;
      return {
        entries: page.entries.map((version) => ({
          id: version.version,
          label: `${t("Version")} ${version.version}`,
          text: version.text,
        })),
        next: page.next,
      };
    },
    [binding, id, request],
  );
  const records = useCharacterRecords(read);
  const entries = records.page?.entries ?? [];
  const first = entries[0]?.id;
  const selected = entries.find((entry) => entry.id === value);
  const identity = binding === "identityVersion";

  useEffect(() => {
    if (identity && value === null && first !== undefined) onChange(first);
  }, [first, identity, onChange, value]);

  return (
    <div>
      <label>
        {t(labels[binding])}
        <select
          className="ui-select"
          value={value ?? ""}
          disabled={disabled || records.loading}
          required={identity}
          onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="" disabled={identity}>
            {t(identity ? "Choose a version" : "No selection")}
          </option>
          {value !== null && !selected && (
            <option value={value}>
              {t("Saved input")} {value}
            </option>
          )}
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      {selected?.text && <p className="visual-assets-backup-path">{selected.text}</p>}
      {records.page?.next != null && (
        <button
          type="button"
          className="ui-button"
          disabled={records.loading}
          onClick={() => void records.more()}
        >
          {t("Load older inputs")}
        </button>
      )}
      {records.error && (
        <button type="button" className="ui-button" onClick={records.reload}>
          {t("Reload inputs")}
        </button>
      )}
    </div>
  );
}
