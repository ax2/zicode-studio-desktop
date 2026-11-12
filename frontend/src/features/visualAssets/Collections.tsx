import { useState } from "react";
import { t } from "../../shared/i18n";

export interface Collection {
  id: string;
  name: string;
}

export type CollectionEdit =
  | { kind: "create"; name: string }
  | { kind: "rename"; id: string; previous: string; name: string }
  | { kind: "delete"; id: string; previous: string }
  | { kind: "membership"; id: string; assetId: number; member: boolean };

function editError(reason: unknown) {
  const code = String(reason);
  if (code.includes("visual_assets_collection_name_used"))
    return t("A collection already has that name.");
  if (code.includes("visual_assets_invalid_collection_name"))
    return t("Enter a collection name of up to 64 characters.");
  if (
    code.includes("visual_assets_collection_changed") ||
    code.includes("visual_assets_library_changed")
  ) {
    return t("The collection changed. Refresh and try again.");
  }
  return t("Could not save the collection change.");
}

interface ToolbarProps {
  collections: Collection[];
  selected: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onEdit: (edit: CollectionEdit) => Promise<void>;
}

export function CollectionToolbar({
  collections,
  selected,
  disabled,
  onSelect,
  onEdit,
}: ToolbarProps) {
  const current = collections.find((entry) => entry.id === selected);
  const [mode, setMode] = useState<
    { kind: "create" } | { kind: "rename" | "delete"; target: Collection } | null
  >(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const unavailable = disabled || saving;

  async function save() {
    if (unavailable || !mode) return;
    const name = draft.trim();
    let edit: CollectionEdit;
    if (mode.kind === "create" && name) edit = { kind: "create", name };
    else if (mode.kind === "rename" && name)
      edit = { kind: "rename", id: mode.target.id, previous: mode.target.name, name };
    else if (mode.kind === "delete")
      edit = { kind: "delete", id: mode.target.id, previous: mode.target.name };
    else return;
    setSaving(true);
    setError("");
    try {
      await onEdit(edit);
      setMode(null);
    } catch (reason) {
      setError(editError(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label={t("Collections")}>
      <div className="ui-toolbar">
        <select
          className="ui-select"
          aria-label={t("Filter by collection")}
          value={selected}
          disabled={unavailable}
          onChange={(event) => {
            setMode(null);
            setError("");
            onSelect(event.target.value);
          }}
        >
          <option value="">{t("All images")}</option>
          {collections.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ui-button"
          disabled={unavailable}
          onClick={() => {
            setError("");
            setDraft("");
            setMode({ kind: "create" });
          }}
        >
          {t("New collection")}
        </button>
        {current && (
          <>
            <button
              type="button"
              className="ui-button"
              disabled={unavailable}
              onClick={() => {
                setError("");
                setDraft(current.name);
                setMode({ kind: "rename", target: current });
              }}
            >
              {t("Rename collection")}
            </button>
            <button
              type="button"
              className="ui-button"
              disabled={unavailable}
              onClick={() => {
                setError("");
                setMode({ kind: "delete", target: current });
              }}
            >
              {t("Delete collection")}
            </button>
          </>
        )}
      </div>
      {mode && (
        <form
          className="ui-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {mode.kind === "delete" ? (
            <p>
              {t("Delete {name} and its memberships?").replace("{name}", () => mode.target.name)}
            </p>
          ) : (
            <input
              className="ui-input"
              aria-label={t("Collection name")}
              value={draft}
              maxLength={128}
              disabled={unavailable}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          <button
            type="submit"
            className="ui-button"
            disabled={unavailable || (mode.kind !== "delete" && !draft.trim())}
          >
            {t(mode.kind === "delete" ? "Confirm collection deletion" : "Save collection")}
          </button>
          <button
            type="button"
            className="ui-button"
            disabled={saving}
            onClick={() => setMode(null)}
          >
            {t("Cancel")}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function AssetCollectionPicker({
  collections,
  selected,
  memberships,
  name,
  assetId,
  disabled,
  onEdit,
}: {
  collections: Collection[];
  selected: string;
  memberships: string[];
  name: string;
  assetId: number;
  disabled: boolean;
  onEdit: ToolbarProps["onEdit"];
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = choice ?? (selected || memberships[0] || "");
  const member = memberships.includes(id);
  if (!collections.length) return null;
  async function change() {
    setSaving(true);
    setError("");
    try {
      await onEdit({ kind: "membership", id, assetId, member: !member });
    } catch (reason) {
      setError(editError(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="ui-toolbar">
      <select
        className="ui-select"
        aria-label={t("Choose a collection for {name}").replace("{name}", () => name)}
        value={id}
        disabled={disabled || saving}
        onChange={(event) => setChoice(event.target.value)}
      >
        <option value="">{t("Choose a collection")}</option>
        {collections.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
            {memberships.includes(entry.id) ? ` · ${t("In collection")}` : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="ui-button ui-button--sm"
        disabled={disabled || saving || !id}
        onClick={() => void change()}
      >
        {t(member ? "Remove from collection" : "Add to collection")}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
