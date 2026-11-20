import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { OutfitImagePreview } from "./OutfitImagePreview";
import type { Invoke } from "./VisualAssetsApp";

export { OutfitImagePreview } from "./OutfitImagePreview";

type Image = { id: number; name: string };
export type LibraryRequest = (
  request: Record<string, unknown>,
  options?: { retryBusy?: boolean },
) => Promise<unknown>;

export function OutfitImagePicker({
  title,
  optional,
  selected,
  onSelect,
  request,
  libraryId,
  disabled,
  onBusyChange,
}: {
  title: string;
  optional?: boolean;
  selected?: Image;
  onSelect: (image?: Image) => void;
  request: LibraryRequest;
  libraryId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [page, setPage] = useState<{ assets: Image[]; next: number | null }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function list(after = 0) {
    if (disabled || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(false);
    try {
      const value = (await request({ kind: "list", query: query || undefined, after })) as {
        page: NonNullable<typeof page>;
      };
      if (active.current) setPage(value.page);
    } catch {
      if (active.current) setError(true);
    } finally {
      if (active.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  async function choose() {
    if (disabled || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(false);
    try {
      const value = (await request({ kind: "import" })) as { cancelled?: boolean; assetId: number };
      if (value.cancelled || !active.current) return;
      const found = (await request({ kind: "list", after: value.assetId - 1 })) as {
        page: { assets: Image[] };
      };
      if (!active.current) return;
      onSelect(
        found.page.assets.find((image) => image.id === value.assetId) ?? {
          id: value.assetId,
          name: t("Selected image"),
        },
      );
    } catch {
      if (active.current) setError(true);
    } finally {
      if (active.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  return (
    <fieldset className="ui-card" disabled={disabled || busy}>
      <legend>{t(title)}</legend>
      <p>{t("Choosing a new image stores a local copy. Nothing is uploaded yet.")}</p>
      <button type="button" className="ui-button" onClick={() => void choose()}>
        {t("Choose new image")} · {t(title)}
      </button>
      <button type="button" className="ui-button" onClick={() => void list()}>
        {t("Choose from library")} · {t(title)}
      </button>
      {optional && selected && (
        <button type="button" className="ui-button" onClick={() => onSelect()}>
          {t("Remove clothing reference")}
        </button>
      )}
      {selected && (
        <>
          <p>{selected.name}</p>
          <OutfitImagePreview
            request={request}
            libraryId={libraryId}
            assetId={selected.id}
            label={t(title)}
          />
        </>
      )}
      {page && (
        <div>
          <label>
            {t("Search image filenames")}
            <input
              className="ui-input"
              value={query}
              maxLength={64}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className="ui-button" onClick={() => void list()}>
            {t("Search")}
          </button>
          {page.assets.map((image) => (
            <button
              type="button"
              className="ui-button"
              key={image.id}
              onClick={() => {
                onSelect(image);
                setPage(undefined);
              }}
            >
              {image.name}
            </button>
          ))}
          {!page.assets.length && <p>{t("No filenames match this search.")}</p>}
          {page.next != null && (
            <button type="button" className="ui-button" onClick={() => void list(page.next ?? 0)}>
              {t("Next page")}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{t("Could not select this image. Retry the selection.")}</p>}
    </fieldset>
  );
}
export function libraryRequest(invoke: Invoke, workspaceId: string): LibraryRequest {
  return async (request, { retryBusy = true } = {}) => {
    const call = () => invoke("visual_assets_control", { workspaceId, request });
    try {
      return await call();
    } catch (error) {
      if (!retryBusy || String(error) !== "visual_assets_busy") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return call();
    }
  };
}
