import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import type { LibraryRequest } from "./OutfitImagePicker";

export function OutfitImagePreview(props: {
  request: LibraryRequest;
  libraryId: string;
  assetId: number;
  label: string;
}) {
  return <Preview key={JSON.stringify([props.libraryId, props.assetId])} {...props} />;
}

function Preview({
  request,
  libraryId,
  assetId,
  label,
}: {
  request: LibraryRequest;
  libraryId: string;
  assetId: number;
  label: string;
}) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly reloads the same asset after a local preview failure.
  useEffect(() => {
    let current = true;
    setUrl("");
    setState("loading");
    void (async () => {
      try {
        const ticket = (await request({ kind: "preview", libraryId, assetId, revision: 1 })) as {
          handle: string;
        };
        if (!current) return;
        const data = (await request({ kind: "readPreview", handle: ticket.handle })) as {
          mimeType: string;
          base64: string;
        };
        if (!current) return;
        if (data.mimeType !== "image/png" || !data.base64 || data.base64.length > 700_000) {
          setState("error");
          return;
        }
        setUrl(`data:image/png;base64,${data.base64}`);
      } catch {
        if (current) setState("error");
      }
    })();
    return () => {
      current = false;
    };
  }, [request, libraryId, assetId, attempt]);
  return (
    <>
      {state === "loading" && <p role="status">{t("Loading...")}</p>}
      {state !== "error" && url && (
        <img
          src={url}
          alt={label}
          onLoad={() => setState("ready")}
          onError={() => {
            setUrl("");
            setState("error");
          }}
        />
      )}
      {state === "error" && (
        <>
          <p role="status">{t("Preview unavailable")}</p>
          <button
            type="button"
            className="ui-button"
            onClick={() => {
              setState("loading");
              setAttempt((value) => value + 1);
            }}
          >
            {t("Try again")} · {label}
          </button>
        </>
      )}
    </>
  );
}
