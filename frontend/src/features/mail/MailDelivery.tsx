import {useCallback,useEffect,useId,useRef,useState} from "react";
import {t} from "../../shared/i18n";
import {gmailError} from "./GmailInbox";
import {mailError} from "./AlibabaInbox";
import type {Draft,Invoke} from "./index";
type Outcome = "accepted" | "rejected" | "unknown" | null;
type Receipt = { status: unknown } | null;

const unsentErrors = new Set([
  "gmail_invalid_draft", "gmail_draft_changed", "gmail_confirmation_required", "gmail_permission_denied",
  "gmail_reauthorize", "gmail_client_not_configured", "gmail_credentials_disabled", "mail_invalid_recipient",
  "mail_invalid_draft", "mail_password_missing", "mail_draft_changed", "mail_credentials_disabled",
]);
const deliveryOutcome = (status: unknown): Exclude<Outcome, null> =>
  status === "accepted" || status === "rejected" ? status : "unknown";
const receiptOutcome = (record: Receipt): Outcome =>
  record === null || record?.status === null ? null : deliveryOutcome(record?.status);
function DraftPreview({text}:{text:string}){
  const [expanded,setExpanded]=useState(false);
  const id=useId();
  // Avoid splitting a surrogate pair at the preview boundary. Sending uses the saved draft unchanged.
  const cut=/[\uD800-\uDBFF]/.test(text.charAt(419))?419:420;
  const long=text.length>cut;
  return <section aria-label={t("Message body preview")}>
    <p>{t("Message body")}</p>
    <pre id={id} className="mail-read-body" translate="no">{!long||expanded?text||t("Empty message"):text.slice(0,cut)+"…"}</pre>
    {long&&<button className="ui-button" type="button" aria-controls={id} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>
      {t(expanded?"Show less":"Show full message body")}
    </button>}
  </section>;
}

export function MailDelivery({invoke,id,address,draft,configured,provider="alibaba"}:{provider?:"gmail"|"alibaba",invoke:Invoke,id:string,address:string,draft:Draft,configured:boolean}){
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [check, setCheck] = useState<"pending" | "retrying" | "ready" | "failed">("pending");
  const [attempt, setAttempt] = useState(0);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const explain = provider === "gmail" ? gmailError : mailError;
  const reviewButton = useRef<HTMLButtonElement>(null);
  const active = useRef<symbol | null>(null);
  const locked = useRef(false);
  const readReceipt = useCallback(() => invoke<Receipt>({
    kind: "delivery", accountId: id, draftId: draft.id, revision: draft.revision,
  }), [invoke, id, draft.id, draft.revision]);

  useEffect(() => {
    const owner = Symbol();
    active.current = owner;
    setCheck(attempt === 0 ? "pending" : "retrying");
    setReview(false);
    setError("");
    void readReceipt().then(record => {
      if (active.current !== owner) return;
      // An empty local read cannot prove that an uncertain send did not happen.
      setOutcome(previous => receiptOutcome(record) ?? previous);
      setCheck("ready");
    }).catch(() => {
      if (active.current !== owner) return;
      setCheck("failed");
      setError(t("Could not check local delivery status."));
    });
    return () => { if (active.current === owner) active.current = null; };
  }, [readReceipt, attempt]);

  async function submit() {
    const owner = active.current;
    if (!owner || !review || locked.current || outcome || check !== "ready" || !configured) return;
    const current = () => active.current === owner;
    locked.current = true;
    setBusy(true);
    setError("");
    setReview(false);
    try {
      const reply = await invoke<{ status: unknown }>({
        kind: "send", accountId: id, draftId: draft.id, revision: draft.revision, confirmed: true,
      });
      if (current()) setOutcome(deliveryOutcome(reply?.status));
    } catch (error) {
      if (!current()) return;
      // Receipt recovery can only read the local journal for this revision.
      try {
        const stored = receiptOutcome(await readReceipt());
        if (!current()) return;
        if (stored) setOutcome(stored);
        else if (unsentErrors.has(String(error).replace(/^Error:\s*/, ""))) setError(explain(error));
        else setOutcome("unknown");
      } catch { if (current()) setOutcome("unknown"); }
    } finally {
      if (current()) setBusy(false);
      locked.current = false;
    }
  }

  const checking = check === "pending" || check === "retrying";
  const showRetry = outcome === "unknown" || check === "failed" || check === "retrying";
  return <section aria-label={t("Send saved draft")}>
    {!outcome&&<button className="ui-button" ref={reviewButton} type="button" disabled={!configured || check !== "ready" || busy || !draft.recipient.trim()} onClick={()=>setReview(true)}>{t("Review before sending")}</button>}
    {review&&!outcome&&<section className="mail-send-review" aria-label={t("Confirm sending email")}>
      <p>{t("Send this saved draft now?")}</p><dl>
        <dt>{t("Mail account")}</dt><dd translate="no">{address}</dd><dt>{t("Recipient")}</dt><dd translate="no">{draft.recipient}</dd>
        <dt>{t("Mail subject")}</dt><dd translate="no">{draft.subject||t("No subject")}</dd></dl>
      <DraftPreview text={draft.body}/>
      {Boolean(draft.attachments?.length)&&<ul aria-label={t("Attachments")}>
        {draft.attachments?.map(file=><li key={file.id} translate="no">{file.name} ({file.size} B)</li>)}
      </ul>}
      <button className="ui-button" type="button" disabled={!configured || check !== "ready" || busy} onClick={()=>void submit()}>{t("Confirm and send email")}</button>
      <button className="ui-button" type="button" onClick={event => {
        setReview(false);
        if (event.currentTarget.ownerDocument.activeElement === event.currentTarget) reviewButton.current?.focus({ preventScroll: true });
      }}>{t("Cancel")}</button>
    </section>}
    {busy&&<p role="status">{t("Sending saved draft…")}</p>}
    {checking && <p role="status">{t("Checking local delivery status…")}</p>}
    {showRetry && <button className="ui-button" type="button" aria-disabled={busy || checking || undefined} onClick={() => {
      if (busy || checking) return;
      setCheck("retrying");
      setAttempt(attempt + 1);
    }}>{t("Check local delivery status")}</button>}
    {outcome&&<p role="status">{t(outcome==="accepted"?"The mail server accepted this message.":outcome==="rejected"
      ?"The server rejected this send. Check the account and recipient before saving a revised draft."
      :provider==="gmail"?"Delivery is unknown. Check Gmail Sent before composing another copy. Studio will not resend this revision.":"Delivery is unknown. The server may have accepted the message. It will not be sent again automatically; check the recipient’s inbox before composing another copy.")}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
