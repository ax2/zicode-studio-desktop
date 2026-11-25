import { MailAttachments, type Attachment } from "./MailAttachments";
import { MailBody } from "./MailBody";
import {MailDisconnect} from "./MailDisconnect";
import {useCallback,useEffect,useRef,useState} from "react";
import {t} from "../../shared/i18n";
import type {Draft,Invoke} from "./index";

export type MessageRef={folder?:string;uidValidity:number,uid:number};
type Cursor={folder?:string;uidValidity:number,before:number};
type Summary={uid:number,subject:string,sender:string,replyTo:string};
type Page={pending?:boolean;uidValidity:number,messages:Summary[],next:Cursor|null};
type Body={summary:Summary,text:string,html?:string|null;bodyLimited?:boolean;attachments?:Attachment[]};
type CredentialStatus = { configured: boolean; enabled: boolean };
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
export function AlibabaInbox({id,folder,setFolder,invoke,discard,onReply,onConfigured,onBusy,draftBusy = false}:{id:string,folder:string,setFolder:(id:string)=>void,invoke:Invoke,discard:()=>boolean|Promise<boolean>,draftBusy?:boolean,
  onReply:(draft:Draft)=>void,onConfigured:(value:boolean)=>void,onBusy:(value:boolean)=>void}) {
  const [folders,setFolders]=useState<{id:string;name:string}[]>([]);
  const [configured,setConfigured]=useState(false),[enabled,setEnabled]=useState(false),[secret,setSecret]=useState("");
  const [credentialError, setCredentialError] = useState("");
  const [page,setPage]=useState<Page|null>(null),[body,setBody]=useState<Body|null>(null),[selected,setSelected]=useState<MessageRef|null>(null);
  const [localBodyFailed, setLocalBodyFailed] = useState(false);
  const [online,setOnline]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState("");
  const live=useRef(false),lock=useRef(false),generation=useRef(0),onConfig=useRef(onConfigured);
  onConfig.current=onConfigured;
  const applyCredentialStatus = useCallback((status: CredentialStatus | null, error = "") => {
    const configured = status?.configured ?? false;
    setConfigured(configured);
    setEnabled(status?.enabled ?? false);
    setCredentialError(error);
    onConfig.current(configured);
  }, []);
  useEffect(()=>{onBusy(busy);return()=>onBusy(false)},[busy,onBusy]);
  const req=<T,>(kind:string,args:Record<string,unknown>={})=>invoke<T>({kind,accountId:id,...args});
  useEffect(()=>{live.current=true;const epoch=++generation.current;lock.current=true;setBusy(true);
    void(async()=>{try{
      const [credentials,inbox,directory]=await Promise.allSettled([
        invoke<CredentialStatus>({kind:"credentialStatus",accountId:id}),
        invoke<Page>({kind:"cachedPage",accountId:id,limit:20}),
        invoke<{id:string;name:string}[]>({kind:"cachedFolders",accountId:id})]);
      if(!live.current||generation.current!==epoch)return;
      if(directory.status==="fulfilled" && Array.isArray(directory.value))setFolders(directory.value);
      if (credentials.status === "fulfilled") applyCredentialStatus(credentials.value);
      else applyCredentialStatus(null, mailError(credentials.reason));
      if(inbox.status==="fulfilled")setPage(inbox.value);
      else if(!String(inbox.reason).includes("mail_cache_empty"))setError(mailError(inbox.reason));
    }finally{if(live.current&&generation.current===epoch){lock.current=false;setBusy(false)}}})();
    return()=>{live.current=false;generation.current++}
  },[id,invoke,applyCredentialStatus]);
  async function run<T>(work:(isCurrent:()=>boolean)=>Promise<T>,apply:(value:T)=>void,reportError?:(message:string)=>void){
    if(lock.current)return;lock.current=true;setBusy(true);
    if (!reportError) setError("");
    const epoch=generation.current;
    const isCurrent = () => live.current && epoch === generation.current;
    try{const v=await work(isCurrent);if(isCurrent())apply(v)}
    catch(e){if(isCurrent()) (reportError ?? setError)(mailError(e))}
    finally{if(live.current&&epoch===generation.current){lock.current=false;setBusy(false)}}
  }
  function retryCredentialStatus() {
    void run(() => req<CredentialStatus>("credentialStatus"), applyCredentialStatus,
      message => applyCredentialStatus(null, message));
  }
  function load(network:boolean,cursor:Cursor|null=null,target=folder){
    void run(async()=>{
      const epoch=generation.current;
      const args={limit:20,...(target==="INBOX"?{}:{folder:target})};
      try {
        const page=await req<Page>(network?"sync":"cachedPage",{cursor,...args});
        let pending=network&&!cursor&&page.pending;
        while(pending&&live.current&&generation.current===epoch)pending=await req<boolean>("catchUp",args);
        return page;
      }
      catch(e){if(!network&&!cursor&&String(e).includes("mail_cache_empty"))return null;throw e}
    },p=>{
      if(!p){setPage(null);setSelected(null);setBody(null);setOnline(false);return}
      setPage(old=>cursor&&old&&old.uidValidity===p.uidValidity?{...p,messages:[...old.messages,...p.messages.filter(n=>!old.messages.some(m=>m.uid===n.uid))]}:p);
      if(network)window.dispatchEvent(new CustomEvent("studio-mail-cache-updated",{detail:id}));
      setOnline(network);if(!cursor){setSelected(null);setBody(null)}
    })
  }
  function refreshFolders() {
    void run(async isCurrent => {
      const items = await req<{ id: string; name: string }[]>("folders");
      if (!isCurrent()) return;
      setFolders(items);
      window.dispatchEvent(new CustomEvent("studio-mail-directory-updated", { detail: id }));
      if (folder === "INBOX" || items.some(item => item.id === folder)) return;
      setFolder("INBOX");
      setPage(null);
      setSelected(null);
      setBody(null);
      setOnline(false);
      try {
        const inbox = await req<Page>("cachedPage", { cursor: null, limit: 20 });
        if (isCurrent()) setPage(inbox);
      } catch (error) {
        if (String(error).replace(/^Error:\s*/, "") !== "mail_cache_empty") throw error;
      }
    }, () => {});
  }
  function pick(m: Summary) {
    if (!page) return;
    readCached({ ...(folder === "INBOX" ? {} : { folder }), uidValidity: page.uidValidity, uid: m.uid }, online && configured);
  }
  function readCached(ref: MessageRef, allowServer: boolean) {
    if (lock.current || ref.uidValidity !== page?.uidValidity || (ref.folder ?? "INBOX") !== folder ||
        !page.messages.some(item => item.uid === ref.uid)) return;
    setSelected(ref);
    setBody(null);
    setLocalBodyFailed(false);
    void run(async isCurrent => {
      try {
        return await req<Body>("cachedBody",ref);
      } catch (error) {
        if (String(error).replace(/^Error:\s*/, "") === "mail_cache_empty") {
          return allowServer && isCurrent() ? req<Body>("read",ref) : null;
        }
        if (isCurrent()) setLocalBodyFailed(true);
        return null;
      }
    }, setBody);
  }
  const chosen=selected && (selected.folder ?? "INBOX") === folder && selected.uidValidity === page?.uidValidity
    ? page.messages.find(m=>m.uid===selected.uid) : undefined;
  return <section aria-label={t("Alibaba Mail inbox")}>
    <fieldset disabled={busy}><legend>{t("Mail connection")}</legend>
      {credentialError ? <>
        <p role="alert">{credentialError}</p>
        <button className="ui-button" type="button" onClick={retryCredentialStatus}>{t("Retry")}</button>
      </> : <p>{!enabled&&!busy?t("System credentials are disabled in this profile."):configured?t("Client password saved on this device."):t("Use your Alibaba Mail third-party client password. Your administrator must allow IMAP and third-party clients.")}</p>}
      <form onSubmit={e=>{e.preventDefault();const value=secret;setSecret("");void run(()=>req<{configured:boolean}>("setPassword",{password:value}),v=>{setConfigured(v.configured);onConfig.current(v.configured)})}}>
        <label>{t("Client password")}<input className="ui-input" type="password" autoComplete="new-password" maxLength={1024} disabled={!enabled} value={secret} onChange={e=>setSecret(e.target.value)}/></label>
        <button className="ui-button" disabled={!enabled||!secret}>{t("Save client password")}</button>
        <MailDisconnect connected={configured} label={t("Remove client password")} prompt={t("Remove this account’s saved client password?")}
          disconnect={clear=>run(()=>req("forgetPassword",{clearCache:clear}),()=>{
            setSecret("");setConfigured(false);setOnline(false);onConfig.current(false);
            if(clear){setFolders([]);setFolder("INBOX");setPage(null);setSelected(null);setBody(null);window.dispatchEvent(new CustomEvent("studio-mail-cache-cleared",{detail:id}))}
          })}/>
      </form>
    </fieldset>
    <fieldset disabled={busy}><legend>{t("Inbox")}</legend>
      <label>{t("IMAP folder")}<select className="ui-select" value={folder} onChange={e=>{
        const next=e.target.value;setFolder(next);setPage(null);setBody(null);setSelected(null);setOnline(false);load(false,null,next);
      }}><option value="INBOX">{t("Inbox")}</option>{folders.filter(f=>f.id!=="INBOX").map(f=><option key={f.id} value={f.id} translate="no">{f.name}</option>)}</select></label>
      <button className="ui-button" type="button" disabled={!configured} onClick={refreshFolders}>{t("Refresh folder list")}</button>
      <button className="ui-button" type="button" onClick={()=>load(false)}>{t(folder==="INBOX"?"Show offline inbox":"Show saved messages")}</button>
      <button className="ui-button" type="button" disabled={!configured} onClick={()=>load(true)}>{t("Refresh from server")}</button>
      {page?<><p>{online?t("Showing messages retrieved from the server."):t("Showing messages saved on this device.")}</p>
        {page.messages.length===0?<p>{t("No messages on this page.")}</p>:<ul className="mail-inbox-list">{page.messages.map(m=><li key={m.uid}><button className="ui-button" type="button" aria-pressed={chosen?.uid===m.uid} onClick={()=>pick(m)}><strong translate="no">{m.subject||t("No subject")}</strong><small translate="no">{m.sender}</small></button></li>)}</ul>}
        {page.next&&<button className="ui-button" type="button" disabled={online&&!configured} onClick={()=>load(online,page.next)}>{t("Load older messages")}</button>}
      </>:<p>{t("No inbox has been saved on this device yet.")}</p>}
      {selected&&chosen&&<article aria-label={t("Selected message")}><h3 translate="no">{chosen.subject||t("No subject")}</h3><p translate="no">{chosen.sender}</p>
        {body?<>{body.bodyLimited && <p>{t("Some message text exceeds the reading limit.")}</p>}<MailBody text={body.text} html={body.html}/><MailAttachments key={selected.uidValidity+"-"+selected.uid} items={body.attachments} invoke={invoke} message={{accountId:id,...selected}}/></>:localBodyFailed ? <>
          <p role="alert">{t("Could not access local mail data.")}</p>
          <button className="ui-button" type="button" onClick={()=>readCached(selected,false)}>{t("Try again")}</button>
        </>:!busy&&<p role="status">{t("This message is not available offline. Download it explicitly to read it.")}</p>}
        {!body&&!localBodyFailed&&<button className="ui-button" type="button" disabled={!configured} onClick={()=>void run(()=>req<Body>("read",selected),setBody)}>{t("Download message body")}</button>}
        <button className="ui-button" type="button" disabled={!chosen.replyTo||draftBusy} onClick={()=>{void run(async()=>await discard()?await req<Draft>("replyDraft",selected):null,d=>{if(d)onReply(d)})}}>{t("Create reply draft")}</button>
      </article>}
    </fieldset>{error&&<p role="alert">{error}</p>}
  </section>;
}
