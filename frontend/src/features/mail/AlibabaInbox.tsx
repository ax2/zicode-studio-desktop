import { MailBody } from "./MailBody";
import {MailDisconnect} from "./MailDisconnect";
import {useEffect,useRef,useState} from "react";
import {t} from "../../shared/i18n";
import type {Draft,Invoke} from "./index";

export type MessageRef={uidValidity:number,uid:number};
type Cursor={uidValidity:number,before:number};
type Summary={uid:number,subject:string,sender:string,replyTo:string};
type Page={uidValidity:number,messages:Summary[],next:Cursor|null};
type Body={summary:Summary,text:string,html?:string|null};
export function mailError(error:unknown) {
  const code=String(error);
  const messages:Record<string,string>={
    mail_client_password_or_admin_policy:"Sign-in was refused. Check the client password and your administrator’s IMAP permissions.",
    mail_credentials_disabled:"System credentials are disabled in this profile.",
    mail_password_missing:"Save an Alibaba Mail client password first.",
    mail_vault_unavailable:"Windows credential storage is unavailable.",
    mail_tls:"The mail server certificate could not be verified.",
    mail_cache_empty:"This message is not available offline. Download it explicitly to read it.",
    mail_message_too_large:"This message exceeds the 4 MiB reading limit.",
    mail_header_too_large:"This message header is too large to display.",
    mail_inbox_changed:"The inbox changed. Refresh it before continuing.",
    mail_draft_changed:"The saved draft changed. Reload it before sending.",
    mail_invalid_recipient:"Enter one valid recipient, then save the draft.",
    mail_invalid_draft:"Check the draft and save it before sending.",
    mail_account_not_found:"This mail account is no longer available.",
    mail_invalid_reply:"This message has no usable reply address.",
    mail_connect:"Could not connect to the mail server. Your local data is unchanged.",
    mail_storage:"Could not access local mail data.",
  };
  return t(messages[code.replace(/^Error:\s*/,"")]??"Mail operation failed. Check the account and try again.");
}
export function AlibabaInbox({id,invoke,discard,onReply,onConfigured,onBusy}:{id:string,invoke:Invoke,discard:()=>boolean|Promise<boolean>,
  onReply:(draft:Draft)=>void,onConfigured:(value:boolean)=>void,onBusy:(value:boolean)=>void}) {
  const [configured,setConfigured]=useState(false),[enabled,setEnabled]=useState(false),[secret,setSecret]=useState("");
  const [page,setPage]=useState<Page|null>(null),[body,setBody]=useState<Body|null>(null),[selected,setSelected]=useState<MessageRef|null>(null);
  const [online,setOnline]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const live=useRef(false),lock=useRef(false),generation=useRef(0),onConfig=useRef(onConfigured);
  onConfig.current=onConfigured;
  useEffect(()=>{onBusy(busy);return()=>onBusy(false)},[busy,onBusy]);
  const req=<T,>(kind:string,args:Record<string,unknown>={})=>invoke<T>({kind,accountId:id,...args});
  useEffect(()=>{live.current=true;const epoch=++generation.current;lock.current=true;setBusy(true);
    void(async()=>{try{
      const [credentials,inbox]=await Promise.allSettled([
        invoke<{configured:boolean,enabled:boolean}>({kind:"credentialStatus",accountId:id}),
        invoke<Page>({kind:"cachedPage",accountId:id,limit:20})]);
      if(!live.current||generation.current!==epoch)return;
      if(credentials.status==="fulfilled"){setConfigured(credentials.value.configured);setEnabled(credentials.value.enabled);onConfig.current(credentials.value.configured)}
      else setError(mailError(credentials.reason));
      if(inbox.status==="fulfilled")setPage(inbox.value);
      else if(!String(inbox.reason).includes("mail_cache_empty"))setError(mailError(inbox.reason));
    }finally{if(live.current&&generation.current===epoch){lock.current=false;setBusy(false)}}})();
    return()=>{live.current=false;generation.current++}
  },[id,invoke]);
  async function run<T>(work:()=>Promise<T>,apply:(value:T)=>void){
    if(lock.current)return;lock.current=true;setBusy(true);setError("");
    const epoch=generation.current;
    try{const v=await work();if(live.current&&epoch===generation.current)apply(v)}
    catch(e){if(live.current&&epoch===generation.current)setError(mailError(e))}
    finally{if(live.current&&epoch===generation.current){lock.current=false;setBusy(false)}}
  }
  function load(network:boolean,cursor:Cursor|null=null){
    void run(()=>req<Page>(network?"sync":"cachedPage",{cursor,limit:20}),p=>{
      setPage(old=>cursor&&old&&old.uidValidity===p.uidValidity?{...p,messages:[...old.messages,...p.messages.filter(n=>!old.messages.some(m=>m.uid===n.uid))]}:p);
      setOnline(network);if(!cursor){setSelected(null);setBody(null)}
    })
  }
  function pick(m:Summary){
    if(!page)return;const ref={uidValidity:page.uidValidity,uid:m.uid};setSelected(ref);setBody(null);
    void run(async()=>{
      if(online)return await req<Body>("read",ref);
      try{return await req<Body>("cachedBody",ref)}
      catch(e){if(String(e).includes("mail_cache_empty"))return null;throw e}
    },setBody)
  }
  const chosen=page?.messages.find(m=>m.uid===selected?.uid);
  return <section aria-label={t("Alibaba Mail inbox")}>
    <fieldset disabled={busy}><legend>{t("Mail connection")}</legend>
      <p>{!enabled&&!busy&&!error?t("System credentials are disabled in this profile."):configured?t("Client password saved on this device."):t("Use your Alibaba Mail third-party client password. Your administrator must allow IMAP and third-party clients.")}</p>
      <form onSubmit={e=>{e.preventDefault();const value=secret;setSecret("");void run(()=>req<{configured:boolean}>("setPassword",{password:value}),v=>{setConfigured(v.configured);onConfig.current(v.configured)})}}>
        <label>{t("Client password")}<input type="password" autoComplete="new-password" maxLength={1024} disabled={!enabled} value={secret} onChange={e=>setSecret(e.target.value)}/></label>
        <button disabled={!enabled||!secret}>{t("Save client password")}</button>
        <MailDisconnect connected={configured} label={t("Remove client password")} prompt={t("Remove this account’s saved client password?")}
          disconnect={clear=>run(()=>req("forgetPassword",{clearCache:clear}),()=>{
            setSecret("");setConfigured(false);setOnline(false);onConfig.current(false);
            if(clear){setPage(null);setSelected(null);setBody(null);window.dispatchEvent(new CustomEvent("studio-mail-cache-cleared",{detail:id}))}
          })}/>
      </form>
    </fieldset>
    <fieldset disabled={busy}><legend>{t("Inbox")}</legend>
      <button type="button" onClick={()=>load(false)}>{t("Show offline inbox")}</button>
      <button type="button" disabled={!configured} onClick={()=>load(true)}>{t("Refresh from server")}</button>
      {page?<><p>{online?t("Showing messages retrieved from the server."):t("Showing messages saved on this device.")}</p>
        {page.messages.length===0?<p>{t("No messages on this page.")}</p>:<ul className="mail-inbox-list">{page.messages.map(m=><li key={m.uid}><button type="button" aria-pressed={selected?.uid===m.uid} onClick={()=>pick(m)}><strong translate="no">{m.subject||t("No subject")}</strong><small translate="no">{m.sender}</small></button></li>)}</ul>}
        {page.next&&<button type="button" disabled={online&&!configured} onClick={()=>load(online,page.next)}>{t("Load older messages")}</button>}
      </>:<p>{t("No inbox has been saved on this device yet.")}</p>}
      {selected&&chosen&&<article aria-label={t("Selected message")}><h3 translate="no">{chosen.subject||t("No subject")}</h3><p translate="no">{chosen.sender}</p>
        {body?<MailBody text={body.text} html={body.html}/>:!online&&!busy&&<p role="status">{t("This message is not available offline. Download it explicitly to read it.")}</p>}
        {!body&&<button type="button" disabled={!configured} onClick={()=>void run(()=>req<Body>("read",selected),setBody)}>{t("Download message body")}</button>}
        <button type="button" disabled={!chosen.replyTo} onClick={()=>{void run(async()=>await discard()?await req<Draft>("replyDraft",selected):null,d=>{if(d)onReply(d)})}}>{t("Create reply draft")}</button>
      </article>}
    </fieldset>{error&&<p role="alert">{error}</p>}
  </section>;
}
