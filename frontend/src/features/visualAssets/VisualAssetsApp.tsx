import { useCallback, useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import { AssetTags } from "./AssetTags";
import { BackupPanel } from "./BackupPanel";
import { CharacterPanel } from "./CharacterPanel";
import {
  AssetCollectionPicker,
  type Collection,
  type CollectionEdit,
  CollectionToolbar,
} from "./Collections";
import { type ImportItem, ImportResults } from "./ImportResults";
import { referenceMessage, ReferenceSource } from "./ReferenceSource";

export type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
interface Asset {
  id: number;
  name: string;
  digest: string;
  tags?: string[];
  collectionIds?: string[];
  referenced?: boolean;
  archivedReference?: boolean;
  generatedFrom?: { attemptId: string; recipeName: string; recipeVersion: number };
}
interface Listing {
  libraryId: string;
  collections?: Collection[];
  page: { assets: Asset[]; next: number | null };
  charactersAvailable?: boolean;
  hasCharacters?: boolean;
}

export function VisualAssetsApp({
  invoke,
  workspaceId,
  sceneId,
}: {
  invoke: Invoke;
  workspaceId: string;
  sceneId?: string;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [animationLibraryId, setAnimationLibraryId] = useState("");
  const [characterLibraryId, setCharacterLibraryId] = useState("");
  const [cursors, setCursors] = useState([0]);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tag, setTag] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [importItems, setImportItems] = useState<ImportItem[] | null>(null);
  const [previews, setPreviews] = useState<Record<number, { url: string; message: string }>>({});
  const after = cursors[cursors.length - 1];
  const reloadLibrary = useCallback(() => {
    setCursors([0]);
    setRefresh((value) => value + 1);
  }, []);
  const refreshLibrary = useCallback(() => setRefresh((value) => value + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly reloads the current page after import or retry.
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError("");
    setListing(null);
    setPreviews({});
    const request = (value: Record<string, unknown>) =>
      invoke("visual_assets_control", { workspaceId, request: value });
    async function load() {
      try {
        const result = (await request({
          kind: "list",
          after,
          query: query || undefined,
          ...(tag ? { tag } : {}),
          ...(collectionId ? { collectionId } : {}),
          ...(duplicatesOnly ? { duplicatesOnly: true } : {}),
        })) as Listing;
        if (!current) return;
        if (collectionId && !result.collections?.some((entry) => entry.id === collectionId)) {
          setCollectionId("");
          setCursors([0]);
          return;
        }
        setListing(result);
        setAnimationLibraryId(result.libraryId);
        setCharacterLibraryId(result.charactersAvailable ? result.libraryId : "");
        setBusy(false);
        // One preview at a time keeps browser interaction ahead of prefetching.
        for (const asset of result.page.assets) {
          if (!current) return;
          const preview = { url: "", message: "Preview unavailable" };
          try {
            const ticket = (await request({
              kind: "preview",
              libraryId: result.libraryId,
              assetId: asset.id,
              revision: 1,
            })) as { handle: string };
            if (!current) return;
            const data = (await request({ kind: "readPreview", handle: ticket.handle })) as {
              mimeType: string;
              base64: string;
            };
            if (data.mimeType === "image/png" && data.base64.length <= 700_000)
              preview.url = `data:image/png;base64,${data.base64}`;
          } catch (reason) {
            preview.message = referenceMessage(reason, preview.message);
          }
          if (current) setPreviews((previous) => ({ ...previous, [asset.id]: preview }));
        }
      } catch (reason) {
        if (current) {
          setError(
            t(
              String(reason).includes("visual_assets_invalid_tags")
                ? "Enter one tag of at most 32 characters."
                : String(reason).includes("visual_assets_busy")
                  ? "The visual library is busy. Wait for the current task to finish, then refresh."
                  : "The visual library could not be loaded. Retry in the local default workspace.",
            ),
          );
          setBusy(false);
        }
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [invoke, workspaceId, after, query, tag, collectionId, duplicatesOnly, refresh]);

  async function changeCollection(edit: CollectionEdit) {
    if (!listing) return;
    await invoke("visual_assets_control", {
      workspaceId,
      request: { kind: "changeCollections", libraryId: listing.libraryId, edit },
    });
    if (edit.kind === "delete" && edit.id === collectionId) {
      setCollectionId("");
      reloadLibrary();
    } else {
      setRefresh((value) => value + 1);
    }
  }

  async function importImages(kind: "importBatch" | "importReferences") {
    setBusy(true);
    setError("");
    setImportItems(null);
    try {
      const result = (await invoke("visual_assets_control", {
        workspaceId,
        request: { kind },
      })) as { items?: ImportItem[] };
      if (result.items) {
        setImportItems(result.items);
        if (
          result.items.some((item) => item.status === "imported" || item.status === "unconfirmed")
        ) {
          reloadLibrary();
        }
      }
    } catch (reason) {
      const code = String(reason);
      if (code.includes("visual_assets_batch_limit")) {
        setError(t("Select up to 16 images at a time."));
      } else if (code.includes("visual_assets_busy")) {
        setError(
          t("The visual library is busy. Wait for the current task to finish, then refresh."),
        );
      } else {
        setError(
          t(
            referenceMessage(
              reason,
              "Image import failed. Use a static PNG, JPEG or WebP within 24 MiB and 4096 pixels per side.",
            ),
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function reconnectSource(assetId: number) {
    if (!listing) return;
    setBusy(true);
    setError("");
    try {
      const result = (await invoke("visual_assets_control", {
        workspaceId,
        request: {
          kind: "reauthorizeReference",
          libraryId: listing.libraryId,
          assetId,
          revision: 1,
        },
      })) as { updated?: boolean };
      if (result.updated) setRefresh((value) => value + 1);
    } catch (reason) {
      setError(t(referenceMessage(reason, "Could not reconnect the source image.")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="visual-assets-main" aria-label={t("Visual assets")}>
      <header className="ui-toolbar">
        <h2>{t("Visual assets")}</h2>
        <button
          type="button"
          className="ui-button ui-button--primary"
          disabled={busy || backupBusy || !workspaceId}
          title={t("Select up to 16 images at a time.")}
          onClick={() => void importImages("importBatch")}
        >
          {t("Import images")}
        </button>
        <button
          type="button"
          className="ui-button"
          disabled={busy || backupBusy || !workspaceId}
          title={t("Choose a source folder, then select up to 16 images.")}
          onClick={() => void importImages("importReferences")}
        >
          {t("Reference images")}
        </button>
        <button
          type="button"
          className="ui-button"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {t("Refresh")}
        </button>
      </header>
      <p>{t("Managed originals remain in your local visual library.")}</p>
      <form
        className="ui-toolbar"
        aria-label={t("Search image filenames")}
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(searchInput.trim());
          setTag(tagInput.trim());
          reloadLibrary();
        }}
      >
        <input
          type="search"
          className="ui-input"
          aria-label={t("Search image filenames")}
          placeholder={t("Search image filenames")}
          value={searchInput}
          maxLength={64}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <input
          type="search"
          className="ui-input"
          aria-label={t("Filter by tag")}
          placeholder={t("Filter by tag")}
          value={tagInput}
          maxLength={64}
          onChange={(event) => setTagInput(event.target.value)}
        />
        <button type="submit" className="ui-button" disabled={busy || backupBusy}>
          {t("Search")}
        </button>
        <label>
          <input
            type="checkbox"
            checked={duplicatesOnly}
            disabled={busy || backupBusy}
            onChange={(event) => {
              setDuplicatesOnly(event.target.checked);
              reloadLibrary();
            }}
          />
          {t("Exact duplicates")}
        </label>
        <button
          type="button"
          className="ui-button"
          disabled={busy || backupBusy || (!query && !searchInput && !tag && !tagInput)}
          onClick={() => {
            setSearchInput("");
            setQuery("");
            setTagInput("");
            setTag("");
            reloadLibrary();
          }}
        >
          {t("Clear search")}
        </button>
      </form>
      <CollectionToolbar
        collections={listing?.collections ?? []}
        selected={collectionId}
        disabled={busy || backupBusy || !listing}
        onSelect={(id) => {
          setCollectionId(id);
          reloadLibrary();
        }}
        onEdit={changeCollection}
      />
      <BackupPanel
        invoke={invoke}
        workspaceId={workspaceId}
        disabled={busy || !workspaceId}
        onBusyChange={setBackupBusy}
        canRestore={
          !query &&
          !tag &&
          !collectionId &&
          !duplicatesOnly &&
          after === 0 &&
          listing?.page.assets.length === 0 &&
          !listing.collections?.length &&
          !listing.hasCharacters
        }
        onRestored={reloadLibrary}
        animation={
          animationLibraryId
            ? { libraryId: animationLibraryId, assets: listing?.page.assets ?? [] }
            : undefined
        }
      />
      {characterLibraryId && (
        <CharacterPanel
          key={JSON.stringify([workspaceId, characterLibraryId])}
          invoke={invoke}
          workspaceId={workspaceId}
          sceneId={sceneId}
          libraryId={characterLibraryId}
          assets={listing?.page.assets ?? []}
          disabled={busy || backupBusy || !listing}
          onChanged={refreshLibrary}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {importItems && <ImportResults items={importItems} />}
      {busy && <p role="status">{t("Loading...")}</p>}
      {listing?.page.assets.length === 0 && (
        <p>
          {t(
            tag || collectionId || duplicatesOnly
              ? "No assets match these filters."
              : query
                ? "No filenames match this search."
                : "Import an image to start your visual library.",
          )}
        </p>
      )}
      <div className="visual-assets-grid">
        {listing?.page.assets.map((asset) => (
          <figure className="ui-card" key={asset.id}>
            {previews[asset.id]?.url ? (
              <img
                src={previews[asset.id].url}
                alt={asset.name}
                onError={() =>
                  setPreviews((previous) => ({
                    ...previous,
                    [asset.id]: { url: "", message: "Preview unavailable" },
                  }))
                }
              />
            ) : (
              <div className="visual-assets-placeholder">
                {t(previews[asset.id]?.message ?? "Loading...")}
              </div>
            )}
            {asset.referenced && (
              <ReferenceSource
                name={asset.name}
                archived={asset.archivedReference}
                disabled={busy || backupBusy}
                onReconnect={() => void reconnectSource(asset.id)}
              />
            )}
            {asset.generatedFrom && (
              <details className="visual-assets-backup-path">
                <summary>{t("Generation source")}</summary>
                <p>
                  {asset.generatedFrom.recipeName} · {t("Revision")}{" "}
                  {asset.generatedFrom.recipeVersion}
                </p>
                <code>{asset.generatedFrom.attemptId}</code>
              </details>
            )}
            <AssetTags
              name={asset.name}
              tags={asset.tags ?? []}
              disabled={busy || backupBusy}
              onSave={async (previous, tags) => {
                await invoke("visual_assets_control", {
                  workspaceId,
                  request: {
                    kind: "setTags",
                    libraryId: listing.libraryId,
                    assetId: asset.id,
                    previous,
                    tags,
                  },
                });
                setRefresh((value) => value + 1);
              }}
              onFilter={(selected) => {
                setTagInput(selected);
                setTag(selected);
                reloadLibrary();
              }}
            />
            <AssetCollectionPicker
              collections={listing.collections ?? []}
              selected={collectionId}
              memberships={asset.collectionIds ?? []}
              name={asset.name}
              assetId={asset.id}
              disabled={busy || backupBusy}
              onEdit={changeCollection}
            />
            <figcaption title={asset.name}>{asset.name}</figcaption>
          </figure>
        ))}
      </div>
      <nav className="ui-toolbar" aria-label={t("Pagination")}>
        <button
          type="button"
          className="ui-button"
          disabled={busy || cursors.length < 2}
          onClick={() => setCursors((values) => values.slice(0, -1))}
        >
          {t("Previous")}
        </button>
        <span>{cursors.length}</span>
        <button
          type="button"
          className="ui-button"
          disabled={busy || listing?.page.next == null}
          onClick={() => {
            const next = listing?.page.next;
            if (next != null) setCursors((values) => [...values, next]);
          }}
        >
          {t("Next")}
        </button>
      </nav>
    </section>
  );
}
