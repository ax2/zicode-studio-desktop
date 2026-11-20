import { useCallback, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { CharacterReferences } from "./CharacterReferences";
import { CharacterRevisions } from "./CharacterRevisions";
import { GenerationRecipes } from "./GenerationRecipes";
import { NovelDraftPanel } from "./NovelDraftPanel";
import {
  type CharacterAsset,
  type CharacterRequest,
  type RecordPage,
  useCharacterRecords,
} from "./useCharacterRecords";
import type { Invoke } from "./VisualAssetsApp";

interface Summary {
  id: string;
  name: string;
}

async function requestWhenAvailable(invoke: () => Promise<unknown>) {
  try {
    return await invoke();
  } catch (reason) {
    const code = reason instanceof Error ? reason.message : String(reason);
    if (code !== "visual_assets_busy") throw reason;
    await new Promise((resolve) => setTimeout(resolve, 80));
    return invoke();
  }
}

export function CharacterPanel({
  invoke,
  workspaceId,
  sceneId,
  libraryId,
  assets,
  disabled,
  onChanged,
}: {
  invoke: Invoke;
  workspaceId: string;
  sceneId?: string;
  libraryId: string;
  assets: CharacterAsset[];
  disabled: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const queue = useRef(Promise.resolve());
  const request = useCallback<CharacterRequest>(
    (action) => {
      const pending = queue.current.then(() =>
        requestWhenAvailable(() =>
          invoke("visual_assets_control", {
            workspaceId,
            request: { kind: "characters", libraryId, action },
          }),
        ),
      );
      queue.current = pending.then(
        () => {},
        () => {},
      );
      return pending;
    },
    [invoke, workspaceId, libraryId],
  );
  const generation = useCallback<CharacterRequest>(
    async (action) => {
      const result = await requestWhenAvailable(() =>
        invoke("visual_assets_control", {
          workspaceId,
          request: { kind: "generation", libraryId, action },
        }),
      );
      if (action.kind === "output" && (action.review as { kind: string }).kind === "approve") {
        onChanged();
      }
      return result;
    },
    [invoke, workspaceId, libraryId, onChanged],
  );
  const novel = useCallback<CharacterRequest>(
    (action) =>
      requestWhenAvailable(() =>
        invoke("visual_assets_control", {
          workspaceId,
          request: { kind: "novelDrafts", libraryId, sceneId, action },
        }),
      ),
    [invoke, workspaceId, libraryId, sceneId],
  );
  return (
    <section className="ui-panel" aria-label={t("Characters")}>
      <button
        className="ui-button"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("Characters")}
      </button>
      {open && (
        <CharacterLibrary
          assets={assets}
          disabled={disabled}
          request={request}
          generation={generation}
          novel={sceneId ? novel : undefined}
          novelScope={sceneId}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

function CharacterLibrary({
  assets,
  disabled,
  request,
  generation,
  novel,
  novelScope,
  onChanged,
}: {
  assets: CharacterAsset[];
  disabled: boolean;
  request: CharacterRequest;
  generation: CharacterRequest;
  novel?: CharacterRequest;
  novelScope?: string;
  onChanged: () => void;
}) {
  const read = useCallback(
    async (after?: string) =>
      (await request({ kind: "list", after })) as RecordPage<Summary, string>,
    [request],
  );
  const records = useCharacterRecords(read);
  const [selected, setSelected] = useState<Summary>();
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [revisionChanged, setRevisionChanged] = useState(0);
  const entries = records.page?.entries ?? [];
  const options =
    selected && !entries.some((entry) => entry.id === selected.id)
      ? [selected, ...entries]
      : entries;

  async function create() {
    if (disabled || saving || !name.trim() || !identity.trim()) return;
    setSaving(true);
    setError(false);
    try {
      const { id } = (await request({ kind: "create", name, identity })) as { id: string };
      setSelected({ id, name: name.trim() });
      setName("");
      setIdentity("");
      records.reload();
      onChanged();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="ui-toolbar">
        <select
          className="ui-select"
          aria-label={t("Choose character")}
          value={selected?.id ?? ""}
          onChange={(event) =>
            setSelected(options.find((entry) => entry.id === event.target.value))
          }
        >
          <option value="">{t("Choose character")}</option>
          {options.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        {records.page?.next && (
          <button
            type="button"
            className="ui-button"
            disabled={records.loading}
            onClick={() => void records.more()}
          >
            {t("Load more characters")}
          </button>
        )}
        {records.error && (
          <button type="button" className="ui-button" onClick={records.reload}>
            {t("Reload characters")}
          </button>
        )}
      </div>
      <details>
        <summary>{t("New character")}</summary>
        <form
          className="ui-card"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label>
            {t("Character name")}
            <input
              className="ui-input"
              required
              maxLength={80}
              value={name}
              disabled={disabled || saving}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            {t("Initial identity")}
            <textarea
              className="ui-textarea"
              required
              maxLength={4000}
              value={identity}
              disabled={disabled || saving}
              onChange={(event) => setIdentity(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="ui-button"
            disabled={disabled || saving || !name.trim() || !identity.trim()}
          >
            {t("Create character")}
          </button>
          {error && <p role="alert">{t("Could not create the character.")}</p>}
        </form>
      </details>
      {selected && (
        <div key={selected.id}>
          <CharacterRevisions
            id={selected.id}
            disabled={disabled}
            request={request}
            revisionChanged={revisionChanged}
          />
          {novel && (
            <NovelDraftPanel
              key={novelScope}
              characterId={selected.id}
              characterName={selected.name}
              disabled={disabled}
              request={novel}
              onApproved={() => setRevisionChanged((revision) => revision + 1)}
            />
          )}
          <CharacterReferences
            id={selected.id}
            assets={assets}
            disabled={disabled}
            request={request}
            onChanged={onChanged}
          />
          <GenerationRecipes
            id={selected.id}
            disabled={disabled}
            request={request}
            generation={generation}
          />
        </div>
      )}
    </>
  );
}
