import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import type { ModelToolSelection } from "../../shared/ModelToolPicker";
import { TARGET_LANGUAGES } from "./translationLogic";

type Destination = { identity: string; destination: string; local: boolean };
type Approval = Destination & { provider: string; model: string; preferred: string; alternate: string };
type Settings = { approval: Approval | null; shortcutError: string | null };
export type ClipboardTranslationInvoke = (request: Record<string, unknown>) => Promise<unknown>;

function clipboardError(reason: unknown) {
  return typeof reason === "string" ? reason : "Clipboard translation is unavailable";
}

export function DesktopClipboardTranslation({ invoke, selection }: {
  invoke: ClipboardTranslationInvoke;
  selection: ModelToolSelection | null;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [review, setReview] = useState<Destination & { selection: ModelToolSelection }>();
  const [preferred, setPreferred] = useState("Chinese");
  const [alternate, setAlternate] = useState("English");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void invoke({ kind: "settings" }).then(raw => {
      if (!active) return;
      const value = raw as Settings;
      setSettings(value);
      if (value.approval) {
        setPreferred(value.approval.preferred);
        setAlternate(value.approval.alternate);
      }
    }).catch(reason => { if (active) setError(clipboardError(reason)); });
    return () => { active = false; };
  }, [invoke]);

  const sameSelection = review && selection && selection.sceneId === review.selection.sceneId &&
    selection.provider === review.selection.provider && selection.model === review.selection.model;

  async function save(request: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      setSettings(await invoke(request) as Settings);
      setReview(undefined);
    } catch (reason) {
      setError(clipboardError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!selection) return;
    setBusy(true);
    setError("");
    try {
      const destination = await invoke({ kind: "preview", provider: selection.provider, model: selection.model }) as Destination;
      setReview({ ...destination, selection });
    } catch (reason) {
      setError(clipboardError(reason));
    } finally {
      setBusy(false);
    }
  }

  const choices = TARGET_LANGUAGES.map(language => <option key={language} value={language}>{t(language)}</option>);
  const approval = settings?.approval;
  return <details>
    <summary>{t("Clipboard translation settings")} · Ctrl+Shift+F8</summary>
    <div className="ui-toolbar">
      <label>{t("Preferred translation language")}{" "}
        <select className="ui-input" value={preferred} onChange={event => setPreferred(event.target.value)}>{choices}</select>
      </label>
      <label>{t("Alternate translation language")}{" "}
        <select className="ui-input" value={alternate} onChange={event => setAlternate(event.target.value)}>{choices}</select>
      </label>
    </div>
    {approval && <p>{t(approval.local ? "Local translation service" : "External translation service")} · {approval.destination}</p>}
    {settings?.shortcutError && <p role="alert">{t(settings.shortcutError)}</p>}
    {!selection && <p>{t("Choose a configured model")}</p>}
    <button type="button" className="ui-button ui-button--secondary" disabled={busy || !selection || !settings} onClick={() => void preview()}>
      {t("Review clipboard translation service")}
    </button>
    {approval && <button type="button" className="ui-button ui-button--ghost" disabled={busy} onClick={() => void save({ kind: "disable" })}>
      {t("Turn off automatic clipboard translation")}
    </button>}
    {sameSelection && <div>
      <p>{t(review.local ? "Local translation service" : "External translation service")} · {review.destination}</p>
      <p>{t("Pressing Ctrl+Shift+F8 sends clipboard text to this service when Studio detects a language.")}</p>
      <button type="button" className="ui-button ui-button--primary" disabled={busy || preferred === alternate} onClick={() => void save({
        kind: "enable", provider: selection.provider, model: selection.model, identity: review.identity, preferred, alternate,
      })}>
        {t("Allow automatic clipboard translation")}
      </button>
    </div>}
    {error && <p role="alert">{t(error)}</p>}
  </details>;
}
