import { useCallback, useState } from "react";
import { t } from "../../shared/i18n";
import { ComfyGeneration } from "./ComfyGeneration";
import { GenerationRecipeForm, type RecipeDraft } from "./GenerationRecipeForm";
import { type CharacterRequest, type RecordPage, useCharacterRecords } from "./useCharacterRecords";

type Props = {
  id: string;
  disabled: boolean;
  request: CharacterRequest;
  generation?: CharacterRequest;
};
type Summary = { id: string; name: string };
type Version = { version: number; draft: RecipeDraft };
type Review = {
  recipe: Version;
  identity: string;
  appearance: string | null;
  style: string | null;
  referenceSet: {
    name: string;
    references: { assetId: number; revision: number; name: string; sha256: string }[];
  } | null;
};

export function GenerationRecipes(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <section className="ui-card" aria-label={t("Generation recipes")}>
      <button
        type="button"
        className="ui-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("Generation recipes")}
      </button>
      {open && <RecipeLibrary {...props} />}
    </section>
  );
}

function RecipeLibrary({ id, disabled, request, generation }: Props) {
  const read = useCallback(
    async (after?: string) =>
      (await request({ kind: "recipes", id, after })) as RecordPage<Summary, string>,
    [id, request],
  );
  const records = useCharacterRecords(read);
  const [selected, setSelected] = useState<Summary>();
  const entries = records.page?.entries ?? [];
  const options =
    selected && !entries.some((entry) => entry.id === selected.id)
      ? [selected, ...entries]
      : entries;

  async function create(name: string, draft: RecipeDraft) {
    const result = (await request({ kind: "createRecipe", id, name, draft })) as { id: string };
    setSelected({ id: result.id, name: name.trim() });
    records.reload();
  }

  return (
    <>
      <div className="ui-toolbar">
        <select
          className="ui-select"
          aria-label={t("Choose generation recipe")}
          value={selected?.id ?? ""}
          onChange={(event) =>
            setSelected(options.find((entry) => entry.id === event.target.value))
          }
        >
          <option value="">{t("New generation recipe")}</option>
          {options.map((recipe) => (
            <option key={recipe.id} value={recipe.id}>
              {recipe.name}
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
            {t("Load more recipes")}
          </button>
        )}
        {records.error && (
          <button type="button" className="ui-button" onClick={records.reload}>
            {t("Reload recipes")}
          </button>
        )}
      </div>
      {selected ? (
        <RecipeVersions
          key={selected.id}
          id={id}
          recipeId={selected.id}
          disabled={disabled}
          request={request}
          generation={generation}
        />
      ) : (
        <GenerationRecipeForm id={id} disabled={disabled} request={request} save={create} />
      )}
    </>
  );
}

function RecipeVersions({
  id,
  recipeId,
  disabled,
  request,
  generation,
}: Props & { recipeId: string }) {
  const read = useCallback(
    async (before?: number) =>
      (await request({ kind: "recipeVersions", id, recipeId, before })) as RecordPage<
        Version,
        number
      >,
    [id, recipeId, request],
  );
  const records = useCharacterRecords(read);
  const latest = records.page?.entries[0];
  const [review, setReview] = useState<Review>();
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState(false);

  async function append(_name: string, draft: RecipeDraft) {
    if (!latest) return;
    try {
      await request({ kind: "appendRecipe", id, recipeId, previous: latest.version, draft });
      records.reload();
    } catch (reason) {
      if (String(reason).includes("visual_assets_recipe_version_changed")) records.reload();
      throw reason;
    }
  }

  async function show(version: number) {
    setReviewing(true);
    setReviewError(false);
    try {
      setReview((await request({ kind: "recipeInputs", id, recipeId, version })) as Review);
    } catch {
      setReviewError(true);
    } finally {
      setReviewing(false);
    }
  }

  return (
    <>
      {latest && (
        <GenerationRecipeForm
          id={id}
          initial={latest.draft}
          disabled={disabled || records.loading || records.error}
          request={request}
          save={append}
        />
      )}
      {records.page?.entries.length ? (
        <ul>
          {records.page.entries.map((entry) => (
            <li key={entry.version}>
              <button
                type="button"
                className="ui-button"
                disabled={reviewing}
                onClick={() => void show(entry.version)}
              >
                {t("Review recipe version")} {entry.version}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {records.page?.next != null && (
        <button
          type="button"
          className="ui-button"
          disabled={records.loading}
          onClick={() => void records.more()}
        >
          {t("Load older versions")}
        </button>
      )}
      {records.error && (
        <button type="button" className="ui-button" onClick={records.reload}>
          {t("Reload recipe versions")}
        </button>
      )}
      {reviewError && <p role="alert">{t("Could not load the saved recipe inputs.")}</p>}
      {review && <SavedRecipe review={review} />}
      {review && generation && (
        <ComfyGeneration
          key={review.recipe.version}
          characterId={id}
          recipeId={recipeId}
          version={review.recipe.version}
          disabled={disabled}
          request={generation}
        />
      )}
    </>
  );
}

function SavedRecipe({ review }: { review: Review }) {
  const {
    recipe: { version, draft },
    identity,
    appearance,
    style,
    referenceSet,
  } = review;
  return (
    <section className="ui-card" aria-label={t("Saved recipe inputs")}>
      <h4>
        {t("Version")} {version}
      </h4>
      <dl>
        <dt>
          {t("Identity version")} {draft.identityVersion}
        </dt>
        <dd>{identity}</dd>
        {appearance && (
          <>
            <dt>
              {t("Appearance version")} {draft.appearanceVersion}
            </dt>
            <dd>{appearance}</dd>
          </>
        )}
        {style && (
          <>
            <dt>
              {t("Style version")} {draft.styleVersion}
            </dt>
            <dd>{style}</dd>
          </>
        )}
        {draft.prompt && (
          <>
            <dt>{t("Generation prompt")}</dt>
            <dd>{draft.prompt}</dd>
          </>
        )}
        {draft.negativePrompt && (
          <>
            <dt>{t("Negative prompt")}</dt>
            <dd>{draft.negativePrompt}</dd>
          </>
        )}
        <dt>{t("Generation settings (JSON)")}</dt>
        <dd className="visual-assets-backup-path">
          <code>{draft.settingsJson}</code>
        </dd>
      </dl>
      {referenceSet && (
        <>
          <p>
            {t("Approved reference set")} · {referenceSet.name}
          </p>
          <ol>
            {referenceSet.references.map((reference) => (
              <li
                key={`${reference.assetId}:${reference.revision}`}
                className="visual-assets-backup-path"
              >
                {reference.name} · {t("Revision")} {reference.revision} ·{" "}
                <code>{reference.sha256}</code>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
