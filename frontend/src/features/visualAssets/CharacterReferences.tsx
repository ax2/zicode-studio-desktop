import { useCallback, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import {
  type CharacterAsset,
  type CharacterRequest,
  type RecordPage,
  useCharacterRecords,
} from "./useCharacterRecords";

interface ReferenceSet {
  id: number;
  name: string;
  references: { assetId: number; revision: number; name: string; sha256: string }[];
}

export function CharacterReferences({
  id,
  assets,
  disabled,
  request,
  onChanged,
}: {
  id: string;
  assets: CharacterAsset[];
  disabled: boolean;
  request: CharacterRequest;
  onChanged: () => void;
}) {
  const read = useCallback(
    async (before?: number) =>
      (await request({ kind: "referenceSets", id, before })) as RecordPage<ReferenceSet, number>,
    [request, id],
  );
  const records = useCharacterRecords(read);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState(0);
  const [selected, setSelected] = useState<CharacterAsset[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef<string | null>(null);
  const available = assets.filter((asset) => !selected.some((item) => item.id === asset.id));
  const candidate = available.find((asset) => asset.id === picked);
  const blocked = disabled || saving;

  function changeSelection(items: CharacterAsset[]) {
    requestId.current = null;
    setSelected(items);
    setPicked(0);
  }

  async function approve() {
    if (blocked || !selected.length || !name.trim()) return;
    setSaving(true);
    setError(false);
    try {
      requestId.current ??= crypto.randomUUID();
      await request({
        kind: "approveReferences",
        id,
        requestId: requestId.current,
        name,
        references: selected.map((asset) => ({ assetId: asset.id, revision: 1 })),
      });
      changeSelection([]);
      setName("");
      records.reload();
      onChanged();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ui-card" aria-label={t("Approved reference sets")}>
      <h3>{t("Approved reference sets")}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void approve();
        }}
      >
        <div className="ui-toolbar">
          <label>
            {t("Reference set name")}
            <input
              className="ui-input"
              required
              maxLength={80}
              value={name}
              disabled={blocked}
              onChange={(event) => {
                requestId.current = null;
                setName(event.target.value);
              }}
            />
          </label>
          <select
            className="ui-select"
            aria-label={t("Reference image")}
            value={candidate?.id ?? ""}
            disabled={blocked || selected.length >= 8}
            onChange={(event) => setPicked(Number(event.target.value))}
          >
            <option value="">{t("Select an image from this page")}</option>
            {available.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ui-button"
            disabled={blocked || !candidate || selected.length >= 8}
            onClick={() => candidate && changeSelection([...selected, candidate])}
          >
            {t("Add reference image")}
          </button>
        </div>
        {selected.length > 0 && (
          <ol>
            {selected.map((asset) => (
              <li key={asset.id}>
                {asset.name}{" "}
                <button
                  className="ui-button ui-button--sm"
                  type="button"
                  disabled={blocked}
                  aria-label={`${t("Remove reference image")} ${asset.name}`}
                  onClick={() => changeSelection(selected.filter((item) => item.id !== asset.id))}
                >
                  {t("Remove")}
                </button>
              </li>
            ))}
          </ol>
        )}
        <p>{t("Approving keeps offline copies of the selected images.")}</p>
        <button
          type="submit"
          className="ui-button"
          disabled={blocked || !selected.length || !name.trim()}
        >
          {t("Approve reference set")}
        </button>
      </form>
      {error && (
        <p role="alert">
          {t(
            "Could not approve the set. Check that the selected originals are available, then retry.",
          )}
        </p>
      )}
      {records.page?.entries.map((set) => (
        <details key={set.id}>
          <summary>
            {set.name} ({set.references.length})
          </summary>
          <ol>
            {set.references.map((reference) => (
              <li
                key={`${reference.assetId}:${reference.revision}`}
                className="visual-assets-backup-path"
              >
                {reference.name} · {t("Revision")} {reference.revision} ·{" "}
                <code>{reference.sha256}</code>
              </li>
            ))}
          </ol>
        </details>
      ))}
      {records.page?.next != null && (
        <button
          type="button"
          className="ui-button"
          disabled={records.loading || saving}
          onClick={() => void records.more()}
        >
          {t("Load older reference sets")}
        </button>
      )}
      {records.error && (
        <button type="button" className="ui-button" onClick={records.reload}>
          {t("Reload reference sets")}
        </button>
      )}
    </section>
  );
}
