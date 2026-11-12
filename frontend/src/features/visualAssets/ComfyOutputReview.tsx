import { t } from "../../shared/i18n";
import { useAnimationReview } from "./useAnimationReview";
import type { CharacterRequest } from "./useCharacterRecords";

export interface ArchivedOutput {
  filename: string;
  assetId: number;
  revision: number;
  sha256: string;
}

type Review = {
  attemptId: string;
  filename: string;
  sha256: string;
  base64: string;
};

function readReview(response: unknown) {
  const { token, review } = response as { token?: string; review?: Review };
  if (!token || !review?.base64) throw new Error("Invalid generation output preview");
  return { token, details: review };
}

export function useComfyOutputReview(
  request: CharacterRequest,
  onArchived: (entry: ArchivedOutput) => void,
) {
  const send = (review: Record<string, unknown>) => request({ kind: "output", review });
  const review = useAnimationReview(
    {
      confirm: async (token) => {
        const { archived } = (await send({ kind: "approve", token })) as {
          archived: ArchivedOutput;
        };
        onArchived(archived);
      },
      cancel: (token) => send({ kind: "cancel", token }),
    },
    readReview,
    "Could not preview this generated image.",
    "Could not archive the image. Preview it again before approving.",
  );
  return {
    ...review,
    preview: (id: string, filename: string) =>
      review.plan(() => send({ kind: "preview", id, filename })),
  };
}

export function ComfyOutputs({
  attemptId,
  files,
  archived,
  control,
  disabled,
}: {
  attemptId: string;
  files: { filename: string }[];
  archived: ArchivedOutput[];
  control: ReturnType<typeof useComfyOutputReview>;
  disabled: boolean;
}) {
  const review = control.review?.attemptId === attemptId ? control.review : undefined;
  return (
    <ul>
      {files.map(({ filename }) => {
        const saved = archived.find((entry) => entry.filename === filename);
        return (
          <li key={filename} className="visual-assets-backup-path">
            <p>{filename}</p>
            {saved ? (
              <p>
                {t("Archived in visual library")} · #{saved.assetId}
              </p>
            ) : (
              <button
                type="button"
                className="ui-button"
                disabled={disabled || control.busy || !!control.review}
                onClick={() => void control.preview(attemptId, filename)}
              >
                {t("Preview generated image")}
              </button>
            )}
            {review?.filename === filename && (
              <div className="ui-card visual-assets-output-review">
                <img alt={filename} src={`data:image/png;base64,${review.base64}`} />
                <p>
                  SHA-256 · <code>{review.sha256}</code>
                </p>
                <div className="ui-toolbar">
                  <button
                    type="button"
                    className="ui-button ui-button--primary"
                    disabled={disabled || control.busy}
                    onClick={() => void control.finish(true)}
                  >
                    {t("Approve and archive image")}
                  </button>
                  <button
                    type="button"
                    className="ui-button"
                    onClick={() => void control.finish(false)}
                  >
                    {t("Cancel")}
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
