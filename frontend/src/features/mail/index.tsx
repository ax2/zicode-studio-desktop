import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { t } from "../../shared/i18n";


import {AlibabaInbox} from "./AlibabaInbox";
import {GmailInbox} from "./GmailInbox";
import {CachedMailSearch} from './CachedMailSearch';
import {MailDelivery} from "./MailDelivery";

type Account={id:string,address:string,provider:string};
export type Draft={id?:string,revision:number,recipient:string,subject:string,body:string,gmailReply?:boolean,attachments?:{id:string,name:string,size:number}[]};
export type Invoke=<T>(request:Record<string,unknown>)=>Promise<T>;
const blank=():Draft=>({revision:0,recipient:"",subject:"",body:""});
const localMailErrors: Record<string,string> = {
  mail_attachment_read: "Could not read the selected file. Check its location and permissions.",
  mail_attachment_too_large: "Attachments in one draft can total up to 16 MiB.",
  mail_attachment_missing: "This attachment is no longer in the draft. Reload the draft.",
  mail_conflict: "Draft changed in another window. Reload before editing.",
  mail_duplicate: "This account is already listed.",
  mail_invalid: "Check the address or shorten the draft.",
};

export function Mail({invoke,transport,gmailTransport}:{invoke:Invoke,transport?:Invoke,gmailTransport?:Invoke}) {
  const [accounts,setAccounts]=useState<Account[]>([]), [account,setAccount]=useState("");
  // Opening a reply can switch the draft account while the same search stays open.
  const [searchVersion, setSearchVersion] = useState(0);
  const [provider,setProvider]=useState("gmail"), [address,setAddress]=useState("");
  const [drafts,setDrafts]=useState<Draft[]>([]), [edit,setEdit]=useState<Draft>(blank);
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState("");
  const lock=useRef(true);
  const composeBody=useRef<HTMLTextAreaElement>(null);
  const focusReply=useRef<string | undefined>(undefined);
  const [passwordOwner,setPasswordOwner]=useState("");
  const [mailActivity,setMailActivity]=useState<{account:string;busy:boolean}|null>(null);
  const owner=accounts.find(a=>a.id===account);
  const [label,setLabel]=useState("INBOX");
  const [gmailSendOwner,setGmailSendOwner]=useState("");
  const gmail=owner?.provider==="gmail"&&gmailTransport;
  const alibaba=owner?.provider==="alibaba"&&transport;
  const mailBusy=Boolean(alibaba&&(!mailActivity||mailActivity.account!==account||mailActivity.busy));
  const reportAlibabaBusy=useCallback((busy:boolean)=>setMailActivity({account,busy}),[account]);
  async function run(fn:()=>Promise<void>, onError?:(error:unknown)=>void) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError("");
    try{await fn()}catch(e){
      if(onError){onError(e);return}
      const msg=String(e);
      const code = Object.keys(localMailErrors).find(key => msg.includes(key));
      setError(t(code ? localMailErrors[code] : "Could not access local mail data."));
    }finally{lock.current=false;setBusy(false)}
  }
  function applyAccount(id:string, rows:Draft[]){
    if(id!==account){setLabel("INBOX");setPasswordOwner("");setGmailSendOwner("");setMailActivity(null)}
    setAccount(id);setDrafts(rows);setEdit(blank());setDirty(false);
  }
  async function load(id:string){
    const rows = id ? await invoke<Draft[]>({kind:"drafts",account:id}) : [];
    if (id !== account) setSearchVersion(version => version + 1);
    applyAccount(id,rows);
  }
  function openReply(draft:Draft){
    setDrafts(old=>[draft,...old.filter(item=>item.id!==draft.id)]);
    setEdit(draft);setDirty(false);
    focusReply.current=draft.id;
  }
  async function replyFromCache(id:string, create:()=>Promise<Draft>, isCurrent:()=>boolean){
    if(mailBusy || !isCurrent() || !accounts.some(row=>row.id===id && (row.provider==="alibaba"||row.provider==="gmail")))return;
    await run(async()=>{
      if(!await discard() || !isCurrent())return;
      const rows=id===account ? undefined : await invoke<Draft[]>({kind:"drafts",account:id});
      if(!isCurrent())return;
      const draft=await create();
      if(!isCurrent())return;
      if(!draft?.id || !Number.isSafeInteger(draft.revision) || draft.revision<1)throw Error("mail_storage");
      if(rows)applyAccount(id,rows);
      openReply(draft);
    }, reason=>{throw reason});
  }
  useEffect(()=>{let live=true;lock.current=true;setBusy(true);void (async()=>{
    try{const rows=await invoke<Account[]>({kind:"accounts"});const id=rows[0]?.id??"";
      const list=id?await invoke<Draft[]>({kind:"drafts",account:id}):[];
      if(live){setAccounts(rows);setAccount(id);setDrafts(list);setSearchVersion(version => version + 1)}
    }catch{if(live)setError(t("Could not access local mail data."))}finally{if(live){lock.current=false;setBusy(false)}}
  })();return()=>{live=false}},[invoke]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};
    window.addEventListener("beforeunload",warn);
    return()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  useEffect(()=>{
    if(busy||mailBusy||!edit.id||focusReply.current!==edit.id)return;
    const timer=setTimeout(()=>{
      const body=composeBody.current;
      if(!body || body.matches(":disabled"))return;
      body.focus();
      if(document.activeElement===body)focusReply.current=undefined;
    });
    return()=>clearTimeout(timer);
  },[busy,mailBusy,edit.id]);
  const discard=async()=>!dirty||await window.confirm(t("Discard unsaved draft changes?"));
  function change(key:"recipient"|"subject"|"body",value:string){setEdit({...edit,[key]:value});setDirty(true)}
  async function changeAttachment(attachment?:string) {
    const result = await invoke<{changed:boolean}>({
      kind: attachment ? "removeAttachment" : "pickAttachment",
      account, id:edit.id, revision:edit.revision, ...(attachment ? {attachment} : {})
    });
    if (!result.changed) return;
    const rows = await invoke<Draft[]>({kind:"drafts",account});
    setDrafts(rows);
    setEdit(rows.find(d => d.id === edit.id) ?? blank());
  }
  return <section className="mail-local"><h2>{t("Mail")}</h2>
    {!alibaba&&!gmail&&<p>{t("Local drafts only. No mailbox is connected.")}</p>}
    <fieldset disabled={busy||mailBusy}><legend>{t("Mail accounts")}</legend>
    {accounts.length>0&&<label>{t("Mail account")}<select className="ui-select" value={account} onChange={e=>{const id=e.target.value;void run(async()=>{if(await discard())await load(id)})}}>{accounts.map(a=><option value={a.id} key={a.id}>{a.address} · {a.provider==="gmail"?t("Gmail"):t("Alibaba Mail")}</option>)}</select></label>}
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{if(!await discard())return;
      const added=await invoke<{id:string}>({kind:"add",provider,address});
      setAccounts(await invoke<Account[]>({kind:"accounts"}));setAddress("");await load(added.id);
    })}}><label>{t("Mail provider")}<select className="ui-select" value={provider} onChange={e=>setProvider(e.target.value)}><option value="gmail">{t("Gmail")}</option><option value="alibaba">{t("Alibaba Mail")}</option></select></label>
    <label>{t("Email address")}<input className="ui-input" required type="email" value={address} onChange={e=>setAddress(e.target.value)} /></label>
    <button className="ui-button ui-button--primary" type="submit">{t("Add local account")}</button></form></fieldset>
    {account&&<CachedMailSearch key={"search-"+searchVersion} accounts={accounts} current={account} invoke={invoke} gmail={gmailTransport} alibaba={transport} onReply={replyFromCache} replyBlocked={busy||mailBusy}/>}
    {gmail&&owner&&<GmailInbox key={account} id={account} address={owner.address} label={label} setLabel={setLabel} invoke={gmail} onGrant={ok=>setGmailSendOwner(ok?account:"")}
      onReply={replyFromCache} draftBusy={busy}/>}
    {alibaba&&<AlibabaInbox key={account} id={account} folder={label} setFolder={setLabel} invoke={alibaba} discard={discard} onBusy={reportAlibabaBusy}
      onConfigured={v=>setPasswordOwner(v?account:"")} onReply={openReply} draftBusy={busy}/>}
    {account&&<fieldset disabled={busy||mailBusy}><legend>{t("Mail drafts")}</legend>
    {edit.gmailReply&&<p>{t("Changing the recipient or subject sends this as a new message.")}</p>}
    <div className="mail-list"><button className="ui-button" type="button" onClick={()=>void run(async()=>{if(await discard()){setEdit(blank());setDirty(false)}})}>{t("New draft")}</button>
    <button className="ui-button" type="button" onClick={()=>void run(async()=>{if(await discard())await load(account)})}>{t("Reload drafts")}</button>
    {drafts.map(d=><button className="ui-button" key={d.id} type="button" aria-pressed={edit.id===d.id} onClick={()=>void run(async()=>{if(await discard()){setEdit(d);setDirty(false)}})}>{d.subject||d.recipient||t("Untitled draft")}</button>)}</div>
    <label>{t("Recipient")}<input className="ui-input" value={edit.recipient} onChange={e=>change("recipient",e.target.value)} /></label>
    <label>{t("Mail subject")}<input className="ui-input" value={edit.subject} onChange={e=>change("subject",e.target.value)} /></label>
    <label>{t("Message body")}<textarea className="ui-textarea" id="studio-mail-compose-body" ref={composeBody} rows={8} value={edit.body} onChange={e=>change("body",e.target.value)} /></label>
    <button className="ui-button" type="button" disabled={!dirty} onClick={()=>void run(async()=>{
      const saved=await invoke<{id:string,revision:number}>({kind:"save",account,id:edit.id,revision:edit.revision,recipient:edit.recipient,subject:edit.subject,body:edit.body});const d={...edit,...saved};setEdit(d);setDirty(false);setDrafts(old=>[d,...old.filter(item=>item.id!==d.id)]);
    })}>{t("Save draft")}</button>
    {edit.id && <div>
      <button className="ui-button" type="button" disabled={dirty} onClick={()=>void run(()=>changeAttachment())}>{t("Add attachment")}</button>
      {edit.attachments?.map(file=><div key={file.id}>{file.name} ({file.size} B) <button className="ui-button" type="button" disabled={dirty} onClick={()=>void run(()=>changeAttachment(file.id))}>{t("Remove attachment")}</button></div>)}
    </div>}
    {gmail&&owner&&edit.id&&!dirty&&<MailDelivery key={JSON.stringify([account,edit.id,edit.revision])} provider="gmail" invoke={gmail} id={account} address={owner.address} draft={edit} configured={gmailSendOwner===account}/>}
    {alibaba&&owner&&edit.id&&!dirty&&<MailDelivery key={JSON.stringify([account,edit.id,edit.revision])} invoke={alibaba} id={account} address={owner.address} draft={edit} configured={passwordOwner===account}/>}
    {edit.id&&<button className="ui-button" type="button" onClick={()=>{void run(async()=>{if(!await window.confirm(t("Delete this local draft?")))return;
      await invoke({kind:"delete",account,id:edit.id,revision:edit.revision});setDrafts(old=>old.filter(item=>item.id!==edit.id));setEdit(blank());setDirty(false);
    })}}>{t("Delete draft")}</button>}</fieldset>}
    {error&&<p role="alert">{error}</p>}</section>;
}
export function setupMailApp(invoke:Invoke,transport?:Invoke,gmailTransport?:Invoke) {
  let root:Root|null=null;
  let mount:HTMLElement|null=null;
  return {
    renderContent(el:HTMLElement){
      if(!mount){mount=document.createElement("div");mount.className="plugin-app-mount";root=createRoot(mount)}
      if(mount.parentNode!==el)el.append(mount);
      root?.render(<Mail invoke={invoke} transport={transport} gmailTransport={gmailTransport}/>);
    },
    deactivate(){},destroy(){root?.unmount();root=null;mount?.remove();mount=null},
    handlesCommand(id:string){return id==="mail.open"},executeCommand(){},async refresh(){},async setTarget(){}
  };
}
