import { useState } from "react";
import { t } from "../../shared/i18n";

interface Props {
  name: string;
  tags: string[];
  disabled: boolean;
  onSave: (previous: string[], tags: string[]) => Promise<void>;
  onFilter: (tag: string) => void;
}

export function AssetTags({ name, tags, disabled, onSave, onFilter }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(value: string) {
    setSaving(true);
    setError("");
    try {
      await onSave(
        tags,
        value
          .split(/[,，]/)
          .map((part) => part.trim())
          .filter(Boolean),
      );
      setDraft(null);
    } catch (reason) {
      const code = String(reason);
      setError(
        t(
          code.includes("visual_assets_tags_changed") ||
            code.includes("visual_assets_library_changed")
            ? "Tags changed elsewhere. Refresh before editing again."
            : code.includes("visual_assets_invalid_tags")
              ? "Use up to 16 tags, each at most 32 characters."
              : "Could not save tags. Try again.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }
  if (draft === null) {
    return (
      <div className="ui-toolbar">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="ui-button ui-button--sm ui-button--ghost"
            disabled={disabled}
            onClick={() => onFilter(tag)}
          >
            {tag}
          </button>
        ))}
        <button
          type="button"
          className="ui-button ui-button--sm"
          disabled={disabled}
          aria-label={t("Edit tags for {name}").replace("{name}", () => name)}
          onClick={() => {
            setError("");
            setDraft(tags.join(", "));
          }}
        >
          {t("Edit tags")}
        </button>
      </div>
    );
  }
  return (
    <form
      className="ui-toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        void save(draft);
      }}
    >
      <input
        className="ui-input"
        aria-label={t("Tags separated by commas")}
        placeholder={t("Tags separated by commas")}
        value={draft}
        maxLength={16 * (32 * 2 + 2)}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="ui-button ui-button--sm" disabled={disabled || saving}>
        {t("Save tags")}
      </button>
      <button
        type="button"
        className="ui-button ui-button--sm"
        disabled={saving}
        onClick={() => setDraft(null)}
      >
        {t("Cancel")}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
