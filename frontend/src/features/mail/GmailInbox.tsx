import { MailAttachments, type Attachment } from "./MailAttachments";
import { MailBody } from "./MailBody";
import {MailDisconnect} from "./MailDisconnect";
import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { Invoke } from "./index";

type Grant = { connected: boolean; read?: boolean; send?: boolean };
type Message = { id: string; from: string; subject: string; date: string; snippet: string };
type Page = { items: Message[]; nextCursor: string | null };
type Label = {id:string; name:string};
type Body = Message & { plainText: string | null; html?: string | null; attachments?: Attachment[] };
const none: Grant = { connected: false };

export function gmailError(e: unknown): string {
  switch(String(e).replace(/^Error:\s*/,"")){
    case "gmail_client_not_configured":return t("Gmail sign-in is not configured in this Studio installation.");
    case "gmail_authorization_denied":return t("Google authorization was declined. Your drafts are unchanged.");
    case "gmail_authorization_timeout":case "gmail_cancelled":return t("Sign-in expired or was canceled. You can start again.");
    case "gmail_credentials_disabled":return t("System credentials are disabled in this profile.");
    case "gmail_permission_denied":case "gmail_reauthorize":return t("Reconnect Gmail with the permission needed for this action.");
    case "gmail_account_mismatch":return t("Choose the same Google account as this local mail address.");
    case "gmail_identity_unavailable":case "gmail_browser_unavailable":return t("Could not open Google sign-in.");
    case "gmail_invalid_draft":return t("Check the recipient address and saved draft before sending.");
    case "gmail_draft_changed":return t("Draft changed in another window. Reload before editing.");
    case "gmail_rate_limited":return t("Google has limited requests. Try again later.");
    case "gmail_network":return t("Could not connect to the mail server. Your local data is unchanged.");
    default:return t("Mail operation failed. Check the account and try again.");
  }
}
export function GmailInbox({id,address,invoke,onGrant}:{id:string;address:string;invoke:Invoke;onGrant:(send:boolean)=>void}) {
  const [grant,setGrant]=useState<Grant>(none),[page,setPage]=useState<Page|null>(null);
  const [labels,setLabels]=useState<Label[]>([]),[label,setLabel]=useState("INBOX");
  const [message,setMessage]=useState<Message|null>(null),[body,setBody]=useState<Body|null>(null);
  const [online,setOnline]=useState(false),[busy,setBusy]=useState("init"),[notice,setNotice]=useState("");
  const epoch=useRef(0),operation=useRef("init"),grantCallback=useRef(onGrant);
  grantCallback.current=onGrant;
  const saveGrant=(g:Grant)=>{setGrant(g);grantCallback.current(Boolean(g.connected&&g.send))};
  useEffect(()=>{
    const gen=++epoch.current;
    operation.current="init"; setBusy("init");setGrant(none);grantCallback.current(false);
    setPage(null);setMessage(null);setBody(null);setOnline(false);setNotice("");
    setLabels([]);setLabel("INBOX");
    void Promise.allSettled([
      invoke<Grant>({kind:"status",accountId:id}),
      invoke<Page|null>({kind:"cachedPage",accountId:id,cursor:null,limit:20}),
      invoke<Label[]|null>({kind:"cachedLabels",accountId:id}),
    ]).then(([s,p,l])=>{
      if(epoch.current!==gen)return;
      if(l.status==="fulfilled"&&Array.isArray(l.value))setLabels(l.value);
      if(s.status==="fulfilled"){setGrant(s.value);grantCallback.current(s.value.connected&&s.value.send===true)}else setNotice(gmailError(s.reason));
      if(p.status==="fulfilled")setPage(p.value);else if(s.status==="fulfilled")setNotice(gmailError(p.reason));
      operation.current="";setBusy("");
    });
    return()=>{epoch.current++;if(operation.current==="connect")void invoke({kind:"cancel",accountId:id}).catch(()=>{})};
  },[id,invoke]);
  async function run<T>(kind:string,task:()=>Promise<T>,apply:(result:T)=>void){
    if(operation.current)return;const gen=++epoch.current;operation.current=kind;setBusy(kind);setNotice("");
    try {const value=await task();if(epoch.current===gen)apply(value)}
    catch(e){if(epoch.current===gen){setNotice(gmailError(e));if(String(e).includes("gmail_reauthorize"))saveGrant(none)}}
    finally {if(epoch.current===gen){operation.current="";setBusy("")}}
  }
  function connect(send:boolean){void run("connect",()=>invoke<Grant>({kind:"connect",send,accountId:id}),g=>{saveGrant(g);if(send&&!g.send)setNotice(t("Google did not grant sending permission."))})}
  async function cancel(){
    if(operation.current!=="connect")return;
    const gen=++epoch.current;operation.current="cancel";setBusy("cancel");
    try{await invoke({kind:"cancel",accountId:id});const fresh=await invoke<Grant>({kind:"status",accountId:id});if(epoch.current===gen){saveGrant(fresh);setNotice(t("Sign-in canceled."))}}
    catch(e){if(epoch.current===gen)setNotice(gmailError(e))}
    finally{if(epoch.current===gen){operation.current="";setBusy("")}}
  }
  function load(server:boolean,cursor:string|null=null,selected=label){
    void run("list",()=>invoke<Page|null>({kind:server?"list":"cachedPage",accountId:id,label:selected,cursor,limit:20}),p=>{
      if(cursor&&p){setPage(old=>({...p,items:[...(old?.items??[]),...p.items.filter(x=>!old?.items.some(i=>i.id===x.id))]}))}
      else if(!cursor){setPage(p);setBody(null);setMessage(null)}else setNotice(t("No older cached page is available."));
      setOnline(server);
    });
  }
  function select(m:Message,server:boolean){
    if(operation.current)return;setMessage(m);setBody(null);
    void run("read",()=>invoke<Body|null>({kind:server?"read":"cachedBody",accountId:id,id:m.id}),setBody);
  }
  const disconnected=!grant.connected;
  return <section aria-label={t("Gmail inbox")}>
    <fieldset disabled={Boolean(busy)}><legend>{t("Mail connection")}</legend>
      <p translate="no">{address}</p>
      <p>{t(disconnected?"Gmail is not connected. Local drafts are still available.":grant.send?"Gmail is connected for reading and sending.":"Gmail is connected for reading.")}</p>
      {disconnected&&<button type="button" onClick={()=>connect(false)}>{t("Sign in to read Gmail")}</button>}
      {!disconnected&&<button type="button" onClick={()=>connect(grant.send===true)}>{t("Reconnect Gmail")}</button>}
      {!disconnected&&!grant.send&&<button type="button" onClick={()=>connect(true)}>{t("Authorize sending with Gmail")}</button>}
      <MailDisconnect connected={!disconnected} label={t("Disconnect Gmail")} prompt={t("Disconnect Gmail on this device? Saved drafts will remain.")}
        disconnect={clear=>run("disconnect",()=>invoke<{revoked:boolean}>({kind:"disconnect",accountId:id,clearCache:clear}),r=>{
          saveGrant(none);setOnline(false);
          if(clear){setLabel("INBOX");setLabels([]);setPage(null);setMessage(null);setBody(null);window.dispatchEvent(new CustomEvent("studio-mail-cache-cleared",{detail:id}))}
          setNotice(t(r.revoked?"Gmail disconnected.":"Disconnected on this device. Review Google account permissions to confirm revocation."))
        })}/>
    </fieldset>
    {busy==="connect"&&<div role="status"><p>{t("Complete authorization in your browser. No email will be sent.")}</p><button type="button" onClick={()=>void cancel()}>{t("Cancel sign-in")}</button></div>}
    <fieldset disabled={Boolean(busy)}><legend>{t("Inbox")}</legend>
      <label>{t("Gmail label")} <select value={label} onChange={e=>{
        const next=e.target.value;setLabel(next);setPage(null);setMessage(null);setBody(null);setOnline(false);load(false,null,next);
      }}>
        <option value="INBOX">{t("Inbox")}</option>
        {labels.filter(item=>item.id!=="INBOX").map(item=><option key={item.id} value={item.id} translate="no">{item.name}</option>)}
      </select></label>
      <button type="button" disabled={!grant.read} onClick={()=>void run("labels",()=>invoke<Label[]>({kind:"labels",accountId:id}),items=>{
        setLabels(items);
        if(label!=="INBOX"&&!items.some(item=>item.id===label)){setLabel("INBOX");setPage(null);setMessage(null);setBody(null);setOnline(false)}
      })}>{t("Refresh Gmail labels")}</button>
      <button type="button" onClick={()=>load(false)}>{t(label==="INBOX"?"Show offline inbox":"Show saved messages")}</button>
      <button type="button" disabled={!grant.read} onClick={()=>load(true)}>{t("Refresh from server")}</button>
      {page?<><p>{t(online?"Showing messages retrieved from the server.":"Showing messages saved on this device.")}</p>
        {!page.items.length&&<p>{t("No messages on this page.")}</p>}
        <ul className="mail-inbox-list">{page.items.map(m=><li key={m.id}><button type="button" aria-pressed={message?.id===m.id} onClick={()=>select(m,online&&grant.read===true)}><strong translate="no">{m.subject||t("No subject")}</strong><small translate="no">{m.from}</small></button></li>)}</ul>
        {page.nextCursor&&<button type="button" onClick={()=>load(online,page.nextCursor)}>{t("Load older messages")}</button>}
      </>:<p>{t("No inbox has been saved on this device yet.")}</p>}
      {message&&<article aria-label={t("Selected message")}><h3 translate="no">{message.subject||t("No subject")}</h3><p translate="no">{message.from}</p>
        {body?<><MailBody text={body.plainText} html={body.html}/><MailAttachments key={message.id} items={body.attachments} invoke={invoke} message={{accountId:id,id:message.id}}/></>:!busy&&<p>{t("This message is not available offline. Download it explicitly to read it.")}</p>}
        {!body&&<button type="button" disabled={!grant.read} onClick={()=>select(message,true)}>{t("Download message body")}</button>}
      </article>}
    </fieldset>
    {notice&&<p role="status">{notice}</p>}
  </section>
}
