import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { t } from "../../shared/i18n";


import {AlibabaInbox} from "./AlibabaInbox";
import {GmailInbox} from "./GmailInbox";
import {CachedMailSearch} from './CachedMailSearch';
import {MailDelivery} from "./MailDelivery";

type Account={id:string,address:string,provider:string};
export type Draft={id?:string,revision:number,recipient:string,subject:string,body:string};
export type Invoke=<T>(request:Record<string,unknown>)=>Promise<T>;
const blank=():Draft=>({revision:0,recipient:"",subject:"",body:""});

export function Mail({invoke,transport,gmailTransport}:{invoke:Invoke,transport?:Invoke,gmailTransport?:Invoke}) {
  const [accounts,setAccounts]=useState<Account[]>([]), [account,setAccount]=useState("");
  const [provider,setProvider]=useState("gmail"), [address,setAddress]=useState("");
  const [drafts,setDrafts]=useState<Draft[]>([]), [edit,setEdit]=useState<Draft>(blank);
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState("");
  const lock=useRef(true);
  const [passwordOwner,setPasswordOwner]=useState("");
  const [mailBusy,setMailBusy]=useState(false);
  const owner=accounts.find(a=>a.id===account);
  const [gmailSendOwner,setGmailSendOwner]=useState("");
  const gmail=owner?.provider==="gmail"&&gmailTransport;
  const alibaba=owner?.provider==="alibaba"&&transport;
  async function run(fn:()=>Promise<void>) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError("");
    try{await fn()}catch(e){
      const msg=String(e);
      setError(t(msg.includes("mail_conflict")?"Draft changed in another window. Reload before editing.":msg.includes("mail_duplicate")?"This account is already listed.":msg.includes("mail_invalid")?"Check the address or shorten the draft.":"Could not access local mail data."));
    }finally{lock.current=false;setBusy(false)}
  }
  async function load(id:string){
    const rows=id?await invoke<Draft[]>({kind:"drafts",account:id}):[];
    if(id!==account){setPasswordOwner("");setGmailSendOwner("")};setMailBusy(false);setAccount(id);setDrafts(rows);setEdit(blank());setDirty(false);
  }
  useEffect(()=>{let live=true;lock.current=true;setBusy(true);void (async()=>{
    try{const rows=await invoke<Account[]>({kind:"accounts"});const id=rows[0]?.id??"";
      const list=id?await invoke<Draft[]>({kind:"drafts",account:id}):[];
      if(live){setAccounts(rows);setAccount(id);setDrafts(list)}
    }catch{if(live)setError(t("Could not access local mail data."))}finally{if(live){lock.current=false;setBusy(false)}}
  })();return()=>{live=false}},[invoke]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};
    window.addEventListener("beforeunload",warn);
    return()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  const discard=async()=>!dirty||await window.confirm(t("Discard unsaved draft changes?"));
  function change(key:"recipient"|"subject"|"body",value:string){setEdit({...edit,[key]:value});setDirty(true)}
  return <section className="mail-local"><h2>{t("Mail")}</h2>
    {!alibaba&&!gmail&&<p>{t("Local drafts only. No mailbox is connected.")}</p>}
    <fieldset disabled={busy||mailBusy}><legend>{t("Mail accounts")}</legend>
    {accounts.length>0&&<label>{t("Mail account")}<select value={account} onChange={e=>{const id=e.target.value;void run(async()=>{if(await discard())await load(id)})}}>{accounts.map(a=><option value={a.id} key={a.id}>{a.address} · {a.provider==="gmail"?t("Gmail"):t("Alibaba Mail")}</option>)}</select></label>}
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{if(!await discard())return;
      const added=await invoke<{id:string}>({kind:"add",provider,address});
      setAccounts(await invoke<Account[]>({kind:"accounts"}));setAddress("");await load(added.id);
    })}}><label>{t("Mail provider")}<select value={provider} onChange={e=>setProvider(e.target.value)}><option value="gmail">{t("Gmail")}</option><option value="alibaba">{t("Alibaba Mail")}</option></select></label>
    <label>{t("Email address")}<input required type="email" value={address} onChange={e=>setAddress(e.target.value)} /></label>
    <button type="submit">{t("Add local account")}</button></form></fieldset>
    {account&&<CachedMailSearch key={"search-"+account} accounts={accounts} current={account} invoke={invoke} gmail={gmailTransport} alibaba={transport}/>}
    {gmail&&owner&&<GmailInbox key={account} id={account} address={owner.address} invoke={gmail} onGrant={ok=>setGmailSendOwner(ok?account:"")}/>}
    {alibaba&&<AlibabaInbox key={account} id={account} invoke={alibaba} discard={discard} onBusy={setMailBusy}
      onConfigured={v=>setPasswordOwner(v?account:"")} onReply={d=>{setDrafts(old=>[d,...old.filter(item=>item.id!==d.id)]);setEdit(d);setDirty(false);requestAnimationFrame(()=>document.getElementById("studio-mail-compose-body")?.focus())}}/>}
    {account&&<fieldset disabled={busy||mailBusy}><legend>{t("Mail drafts")}</legend>
    <div className="mail-list"><button type="button" onClick={()=>void run(async()=>{if(await discard()){setEdit(blank());setDirty(false)}})}>{t("New draft")}</button>
    <button type="button" onClick={()=>void run(async()=>{if(await discard())await load(account)})}>{t("Reload drafts")}</button>
    {drafts.map(d=><button key={d.id} type="button" aria-pressed={edit.id===d.id} onClick={()=>void run(async()=>{if(await discard()){setEdit(d);setDirty(false)}})}>{d.subject||d.recipient||t("Untitled draft")}</button>)}</div>
    <label>{t("Recipient")}<input value={edit.recipient} onChange={e=>change("recipient",e.target.value)} /></label>
    <label>{t("Mail subject")}<input value={edit.subject} onChange={e=>change("subject",e.target.value)} /></label>
    <label>{t("Message body")}<textarea id="studio-mail-compose-body" rows={8} value={edit.body} onChange={e=>change("body",e.target.value)} /></label>
    <button type="button" disabled={!dirty} onClick={()=>void run(async()=>{
      const saved=await invoke<{id:string,revision:number}>({kind:"save",account,...edit});const d={...edit,...saved};setEdit(d);setDirty(false);setDrafts(old=>[d,...old.filter(item=>item.id!==d.id)]);
    })}>{t("Save draft")}</button>
    {account&&<CachedMailSearch key={"search-"+account} accounts={accounts} current={account} invoke={invoke} gmail={gmailTransport} alibaba={transport}/>}
    {gmail&&owner&&edit.id&&!dirty&&<MailDelivery key={JSON.stringify([account,edit.id,edit.revision])} provider="gmail" invoke={gmail} id={account} address={owner.address} draft={edit} configured={gmailSendOwner===account}/>}
    {alibaba&&owner&&edit.id&&!dirty&&<MailDelivery key={JSON.stringify([account,edit.id,edit.revision])} invoke={alibaba} id={account} address={owner.address} draft={edit} configured={passwordOwner===account}/>}
    {edit.id&&<button type="button" onClick={()=>{void run(async()=>{if(!await window.confirm(t("Delete this local draft?")))return;
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