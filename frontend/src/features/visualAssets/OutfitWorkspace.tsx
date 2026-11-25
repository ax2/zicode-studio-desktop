import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { CreationReview } from "./CreationReview";
import { type GameAssetTemplateId, gameAssetTemplates } from "./creation-workflows";
import { GenerationFields } from "./GenerationFields";
import {
  basicCapabilities,
  type GenerationInput,
  generationDefaults,
  type ImageCapabilities,
} from "./generation-types";
import { ImageModelSettings } from "./ImageModelSettings";
import { libraryRequest, OutfitImagePicker } from "./OutfitImagePicker";
import { OutfitTask, OutfitTaskHistory } from "./OutfitTask";
import {
  type CreationRequest,
  type ImageSettings,
  type OutfitPlan,
  outfitError,
} from "./outfit-types";
import { StyleFields } from "./StyleFields";
import { defaultPreservation, type StyleInput, stylePresets } from "./style-presets";
import type { Invoke } from "./VisualAssetsApp";

export function OutfitWorkspace(props: {
  invoke: Invoke;
  workspaceId: string;
  sceneId?: string;
  workflow?: "outfit" | "style" | "generate" | "game";
}) {
  return (
    <Workspace
      key={JSON.stringify([props.workspaceId, props.sceneId, props.workflow])}
      {...props}
    />
  );
}
function Workspace({
  invoke,
  workspaceId,
  sceneId,
  workflow = "outfit",
}: {
  invoke: Invoke;
  workspaceId: string;
  sceneId?: string;
  workflow?: "outfit" | "style" | "generate" | "game";
}) {
  const isStyle = workflow === "style";
  const isGame = workflow === "game";
  const isGeneration = workflow === "generate" || isGame;
  const title = isGame
    ? "Game asset creation"
    : isGeneration
      ? "Text to image and image to image"
      : isStyle
        ? "Image style transfer"
        : "Character outfit change";
  const [generation, setGeneration] = useState<GenerationInput>({ mode: "text", options: {} });
  const needsImage = !isGeneration || generation.mode === "image";
  const library = useMemo(() => libraryRequest(invoke, workspaceId), [invoke, workspaceId]);
  const libraryId = useRef<string | undefined>(undefined);
  const request = useCallback<CreationRequest>(
    (action) =>
      library(
        {
          kind: "creation",
          sceneId: sceneId || "visual-creation",
          libraryId: libraryId.current,
          action,
        },
        { retryBusy: action.kind !== "status" },
      ),
    [library, sceneId],
  );
  const [config, setConfig] = useState<{
    libraryId: string;
    settings: ImageSettings;
    credentialConfigured: boolean;
    capabilities?: ImageCapabilities;
  }>();
  const [person, setPerson] = useState<{ id: number; name: string }>();
  const [clothing, setClothing] = useState<{ id: number; name: string }>();
  const [description, setDescription] = useState(isStyle ? t(stylePresets[0].description) : "");
  const [templateId, setTemplateId] = useState("");
  const [gameDrafts, setGameDrafts] = useState<Partial<Record<GameAssetTemplateId, string>>>({});
  const gameTemplate = gameAssetTemplates.find((template) => template.id === templateId);
  const brief = gameTemplate ? (gameDrafts[gameTemplate.id] ?? t(gameTemplate.brief)) : description;
  const [style, setStyle] = useState<StyleInput>({
    preset: "van-gogh",
    revision: 1,
    strength: "balanced",
    preserve: t(defaultPreservation),
  });
  const [plan, setPlan] = useState<OutfitPlan>();
  const [job, setJob] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [settingsEdited, setSettingsEdited] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const sending = useRef(false);
  const onSelectionBusy = useCallback((pending: boolean) => {
    setBusy(pending);
    if (pending) setPlan(undefined);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is explicit configuration retry.
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError("");
    async function load(attempt = 0) {
      try {
        const value = await request({ kind: "settings" });
        if (!current) return;
        const next = value as NonNullable<typeof config>;
        libraryId.current = next.libraryId;
        setConfig(next);
        setGeneration((current) => ({
          ...current,
          options: generationDefaults(next.settings, next.capabilities ?? basicCapabilities),
        }));
        setError("");
      } catch (reason) {
        if (!current) return;
        // Only this read is retried while another view finishes saving.
        // Generation and approval retain their explicit action boundaries.
        const delay = [250, 500, 1000][attempt];
        if (String(reason) === "visual_assets_busy" && delay !== undefined) {
          timer = setTimeout(() => void load(attempt + 1), delay);
        } else {
          setError(t(outfitError(reason)));
        }
      }
    }
    void load();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [request, revision]);
  async function prepare() {
    if ((needsImage && !person) || !brief.trim() || busy || settingsEdited) return;
    setBusy(true);
    setError("");
    setPlan(undefined);
    try {
      const result = (await request({
        kind: "prepare",
        input: {
          person: needsImage ? (person?.id ?? null) : null,
          clothing: isStyle || isGeneration ? null : (clothing?.id ?? null),
          description: brief,
          ...(isStyle ? { style } : {}),
          ...(isGeneration ? { generation } : {}),
        },
      })) as { plan: OutfitPlan };
      setPlan(result.plan);
    } catch (reason) {
      setError(t(outfitError(reason)));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!plan || busy || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      await request({
        kind: "submit",
        id,
        digest: plan.digest,
        input: plan.input,
        confirmed: true,
      });
    } catch (reason) {
      setError(t(outfitError(reason)));
    } finally {
      setJob(id);
      setPlan(undefined);
      setBusy(false);
      sending.current = false;
    }
  }
  return (
    <section className="visual-assets-outfit" aria-label={t(title)}>
      <h3>{t(title)}</h3>
      <p>
        {t(
          isGame
            ? "Choose a template and edit its brief. Image options depend on the selected model."
            : isGeneration
              ? "Describe an image, or choose a reference to edit. Review the model and parameters before generating."
              : isStyle
                ? "Choose a source image, edit the style and preserved content, then review before uploading."
                : "Choose a person and describe the outfit. Review the model and images before uploading.",
        )}
      </p>
      {isGame && (
        <>
          <label>
            {t("Game asset template")}
            <select
              className="ui-select"
              value={templateId}
              disabled={busy}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setPlan(undefined);
              }}
            >
              <option value="">{t("Choose an asset type")}</option>
              {gameAssetTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {t(template.title)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Game asset brief")}
            <textarea
              className="ui-textarea"
              value={brief}
              maxLength={4000}
              disabled={busy || !gameTemplate}
              onChange={(event) => {
                if (!gameTemplate) return;
                const value = event.target.value;
                setGameDrafts((drafts) => ({ ...drafts, [gameTemplate.id]: value }));
                setPlan(undefined);
              }}
            />
          </label>
        </>
      )}
      {!config && (
        <button
          type="button"
          className="ui-button"
          onClick={() => setRevision((value) => value + 1)}
        >
          {t("Reload image settings")}
        </button>
      )}
      {config && (
        <>
          <ImageModelSettings
            generation={isGeneration}
            settings={config.settings}
            configured={config.credentialConfigured}
            request={request}
            disabled={busy}
            onBusyChange={setBusy}
            onEdit={() => {
              setSettingsEdited(true);
              setPlan(undefined);
            }}
            onSaved={(value) => {
              setConfig({ ...config, ...value });
              setGeneration((current) => ({
                ...current,
                options: generationDefaults(
                  value.settings,
                  value.capabilities ?? basicCapabilities,
                ),
              }));
              setSettingsEdited(false);
              setPlan(undefined);
            }}
          />
          {isGeneration && (
            <GenerationFields
              value={generation}
              capabilities={config.capabilities ?? basicCapabilities}
              disabled={busy || settingsEdited}
              onMode={(mode) => {
                setGeneration({ ...generation, mode });
                setPerson(undefined);
                setPlan(undefined);
              }}
              onChange={(next) => {
                setGeneration(next);
                setPlan(undefined);
              }}
            />
          )}
          {needsImage && (
            <div className="visual-assets-workflows">
              <OutfitImagePicker
                title={isStyle || isGeneration ? "Source image" : "Person image"}
                selected={person}
                onSelect={(value) => {
                  setPerson(value);
                  setPlan(undefined);
                }}
                request={library}
                libraryId={config.libraryId}
                disabled={busy}
                onBusyChange={onSelectionBusy}
              />
              {!isStyle && !isGeneration && (
                <OutfitImagePicker
                  title="Clothing reference (optional)"
                  optional
                  selected={clothing}
                  onSelect={(value) => {
                    setClothing(value);
                    setPlan(undefined);
                  }}
                  request={library}
                  libraryId={config.libraryId}
                  disabled={busy}
                  onBusyChange={onSelectionBusy}
                />
              )}
            </div>
          )}
          {isStyle ? (
            <StyleFields
              value={style}
              description={description}
              disabled={busy}
              onChange={(next, brief) => {
                setStyle(next);
                setDescription(brief);
                setPlan(undefined);
              }}
            />
          ) : !isGame && (
            <>
              <label>
                {t(isGeneration ? "Describe the image to create" : "Describe the new outfit")}
                <textarea
                  className="ui-textarea"
                  value={description}
                  maxLength={4000}
                  disabled={busy}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setPlan(undefined);
                  }}
                />
              </label>
              {!isGeneration && (
                <p>
                  {t(
                    "The model is asked to preserve identity, pose and background. Review the result for unwanted changes.",
                  )}
                </p>
              )}
            </>
          )}
          {settingsEdited && (
            <p role="status">{t("Save your model settings before reviewing a generation plan.")}</p>
          )}
          <button
            type="button"
            className="ui-button ui-button--primary"
            disabled={
              busy ||
              settingsEdited ||
              (needsImage && !person) ||
              !brief.trim() ||
              (isStyle && !style.preserve.trim()) ||
              !config.settings.model ||
              (!isStyle && !isGeneration && person?.id === clothing?.id)
            }
            onClick={() => void prepare()}
          >
            {t(
              isGeneration
                ? "Review image generation"
                : isStyle
                  ? "Review style generation"
                  : "Review outfit generation",
            )}
          </button>
          {plan && (
            <CreationReview
              plan={plan}
              isStyle={isStyle}
              busy={busy}
              onSubmit={() => void submit()}
              onCancel={() => setPlan(undefined)}
            />
          )}
          {job && (
            <OutfitTask
              key={job}
              id={job}
              request={request}
              library={library}
              libraryId={config.libraryId}
            />
          )}
          <OutfitTaskHistory request={request} onOpen={setJob} />
        </>
      )}
      {busy && <p role="status">{t("Loading…")}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
