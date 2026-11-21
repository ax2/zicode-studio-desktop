import {useEffect,useId,useRef,useState} from "react";
import {t} from "../../shared/i18n";
import {gmailError} from "./GmailInbox";
import {mailError} from "./AlibabaInbox";
import type {Draft,Invoke} from "./index";
type Outcome="accepted"|"rejected"|"unknown"|null;
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
  const [outcome,setOutcome]=useState<Outcome>(null),[ready,setReady]=useState(false),[review,setReview]=useState(false),
    [busy,setBusy]=useState(false),[error,setError]=useState("");
  const explain=provider==="gmail"?gmailError:mailError;
  const active=useRef(false),locked=useRef(false);
  useEffect(()=>{active.current=true;let current=true;
    void invoke<{status:Outcome}|null>({kind:"delivery",accountId:id,draftId:draft.id,revision:draft.revision}).then(v=>{
      if(current){setOutcome(v?.status??null);setReady(true)}
    }).catch(e=>{if(current)setError(explain(e))});
    return()=>{current=false;active.current=false};
  },[invoke,id,draft.id,draft.revision,explain]);
  async function submit(){
    if(!review||locked.current||outcome||!ready||!configured)return;locked.current=true;setBusy(true);setError("");setReview(false);
    try{const v=await invoke<{status:Exclude<Outcome,null>}>({kind:"send",accountId:id,draftId:draft.id,revision:draft.revision,confirmed:true});
      if(active.current)setOutcome(["accepted","rejected","unknown"].includes(v.status)?v.status:"unknown")
    }catch(e){if(active.current){
      if(provider==="gmail"){
        // This reads only the local journal. Never repeat a send to recover its result.
        try {
          const stored=await invoke<{status:Exclude<Outcome,null>}|null>({kind:"delivery",accountId:id,draftId:draft.id,revision:draft.revision});
          if(active.current){
            if(stored)setOutcome(["accepted","rejected","unknown"].includes(stored.status)?stored.status:"unknown");
            else setError(explain(e));
          }
        }catch{if(active.current)setOutcome("unknown")}
        return;
      }
      // Only known validation failures occur before a send claim. On any other error,
      // the final result may have been lost; never offer a blind repeat.
      if(["gmail_invalid_draft","gmail_draft_changed","gmail_confirmation_required","gmail_permission_denied","gmail_reauthorize","gmail_client_not_configured","gmail_credentials_disabled","mail_invalid_recipient","mail_invalid_draft","mail_password_missing","mail_draft_changed","mail_credentials_disabled"].includes(String(e).replace(/^Error:\s*/,"")))setError(explain(e));
      else setOutcome("unknown");
    }}finally{if(active.current)setBusy(false);locked.current=false}
  }
  return <section aria-label={t("Send saved draft")}>
    {!outcome&&<button className="ui-button" type="button" disabled={!configured||!ready||busy||!draft.recipient.trim()} onClick={()=>setReview(true)}>{t("Review before sending")}</button>}
    {review&&!outcome&&<section className="mail-send-review" aria-label={t("Confirm sending email")}>
      <p>{t("Send this saved draft now?")}</p><dl>
        <dt>{t("Mail account")}</dt><dd translate="no">{address}</dd><dt>{t("Recipient")}</dt><dd translate="no">{draft.recipient}</dd>
        <dt>{t("Mail subject")}</dt><dd translate="no">{draft.subject||t("No subject")}</dd></dl>
      <DraftPreview text={draft.body}/>
      {Boolean(draft.attachments?.length)&&<ul aria-label={t("Attachments")}>
        {draft.attachments?.map(file=><li key={file.id} translate="no">{file.name} ({file.size} B)</li>)}
      </ul>}
      <button className="ui-button" type="button" disabled={!configured||busy} onClick={()=>void submit()}>{t("Confirm and send email")}</button>
      <button className="ui-button" type="button" onClick={()=>setReview(false)}>{t("Cancel")}</button>
    </section>}
    {busy&&<p role="status">{t("Sending saved draft…")}</p>}
    {outcome&&<p role="status">{t(outcome==="accepted"?"The mail server accepted this message.":outcome==="rejected"
      ?"The server rejected this send. Check the account and recipient before saving a revised draft."
      :provider==="gmail"?"Delivery is unknown. Check Gmail Sent before composing another copy. Studio will not resend this revision.":"Delivery is unknown. The server may have accepted the message. It will not be sent again automatically; check the recipient’s inbox before composing another copy.")}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
