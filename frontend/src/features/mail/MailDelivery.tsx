import {useEffect,useRef,useState} from "react";
import {t} from "../../shared/i18n";
import {mailError} from "./AlibabaInbox";
import type {Draft,Invoke} from "./index";
type Outcome="accepted"|"rejected"|"unknown"|null;
export function MailDelivery({invoke,id,address,draft,configured}:{invoke:Invoke,id:string,address:string,draft:Draft,configured:boolean}){
  const [outcome,setOutcome]=useState<Outcome>(null),[ready,setReady]=useState(false),[review,setReview]=useState(false),
    [busy,setBusy]=useState(false),[error,setError]=useState("");
  const active=useRef(false),locked=useRef(false);
  useEffect(()=>{active.current=true;let current=true;
    void invoke<{status:Outcome}>({kind:"delivery",accountId:id,draftId:draft.id,revision:draft.revision}).then(v=>{
      if(current){setOutcome(v.status);setReady(true)}
    }).catch(e=>{if(current)setError(mailError(e))});
    return()=>{current=false;active.current=false};
  },[invoke,id,draft.id,draft.revision]);
  async function submit(){
    if(!review||locked.current||outcome||!ready||!configured)return;locked.current=true;setBusy(true);setError("");setReview(false);
    try{const v=await invoke<{status:Exclude<Outcome,null>}>({kind:"send",accountId:id,draftId:draft.id,revision:draft.revision,confirmed:true});
      if(active.current)setOutcome(["accepted","rejected","unknown"].includes(v.status)?v.status:"unknown")
    }catch(e){if(active.current){
      // Only known validation failures occur before a send claim. On any other error,
      // the final result may have been lost; never offer a blind repeat.
      if(["mail_invalid_recipient","mail_invalid_draft","mail_password_missing","mail_draft_changed","mail_credentials_disabled"].includes(String(e).replace(/^Error:\s*/,"")))setError(mailError(e));
      else setOutcome("unknown");
    }}finally{if(active.current)setBusy(false);locked.current=false}
  }
  return <section aria-label={t("Send saved draft")}>
    {!outcome&&<button type="button" disabled={!configured||!ready||busy||!draft.recipient.trim()} onClick={()=>setReview(true)}>{t("Review before sending")}</button>}
    {review&&!outcome&&<div className="mail-send-review" aria-label={t("Confirm sending email")}>
      <p>{t("Send this saved draft now?")}</p><dl>
        <dt>{t("Mail account")}</dt><dd translate="no">{address}</dd><dt>{t("Recipient")}</dt><dd translate="no">{draft.recipient}</dd>
        <dt>{t("Mail subject")}</dt><dd translate="no">{draft.subject||t("No subject")}</dd></dl>
      <button type="button" disabled={!configured||busy} onClick={()=>void submit()}>{t("Confirm and send email")}</button>
      <button type="button" onClick={()=>setReview(false)}>{t("Cancel")}</button>
    </div>}
    {busy&&<p role="status">{t("Sending saved draft…")}</p>}
    {outcome&&<p role="status">{t(outcome==="accepted"?"The mail server accepted this message.":outcome==="rejected"
      ?"The server rejected this send. Check the account and recipient before saving a revised draft."
      :"Delivery is unknown. The server may have accepted the message. It will not be sent again automatically; check the recipient’s inbox before composing another copy.")}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
