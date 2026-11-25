import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { t } from "../../shared/i18n";


import {AlibabaInbox, type AlibabaActivity} from "./AlibabaInbox";
import {GmailInbox, type GmailGrantLoss} from "./GmailInbox";
import {CachedMailSearch} from './CachedMailSearch';
import {MailDelivery} from "./MailDelivery";

type Account={id:string,address:string,provider:string};
export type Draft={id?:string,revision:number,recipient:string,subject:string,body:string,gmailReply?:boolean,attachments?:{id:string,name:string,size:number}[]};
export type Invoke=<T>(request:Record<string,unknown>)=>Promise<T>;
type AttachmentRefresh = { account: string; id: string; revision: number };
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
  const [attachmentRefresh, setAttachmentRefresh] = useState<AttachmentRefresh | null>(null);
  const lock=useRef(true);
  const source = useRef<{ invoke: Invoke } | null>(null);
  const composeBody=useRef<HTMLTextAreaElement>(null);
  const addAttachmentButton = useRef<HTMLButtonElement>(null);
  const reloadDraftButton = useRef<HTMLButtonElement>(null);
  const attachmentFocus = useRef<{
    account: string; draftId: string; button: HTMLButtonElement;
  } | null>(null);
  const focusReply=useRef<string | undefined>(undefined);
  const [passwordOwner,setPasswordOwner]=useState("");
  const [mailActivity,setMailActivity]=useState<{account:string;activity:AlibabaActivity}|null>(null);
  const owner=accounts.find(a=>a.id===account);
  const [label,setLabel]=useState("INBOX");
  const [gmailAuthorization,setGmailAuthorization]=useState<{account:string;send:boolean;revision:number;loss?:GmailGrantLoss}|null>(null);
  const gmail=owner?.provider==="gmail"&&gmailTransport;
  const alibaba=owner?.provider==="alibaba"&&transport;
  const activity=alibaba ? mailActivity?.account===account ? mailActivity.activity : "blocking" : null;
  const mailBusy=activity!==null;
  const accountSwitchBlocked=busy||activity==="blocking";
  const reportAlibabaBusy=useCallback((activity:AlibabaActivity)=>setMailActivity({account,activity}),[account]);
  async function run(fn:(isCurrent:()=>boolean)=>Promise<void>, onError?:(error:unknown)=>void) {
    if(lock.current)return;
    const requestSource = source.current;
    const isCurrent = () => source.current === requestSource;
    lock.current=true;setBusy(true);setError("");
    try{await fn(isCurrent)}catch(e){
      if (!isCurrent()) return;
      if(onError){onError(e);return}
      const msg=String(e);
      const code = Object.keys(localMailErrors).find(key => msg.includes(key));
      setError(t(code ? localMailErrors[code] : "Could not access local mail data."));
    }finally{if(isCurrent()){lock.current=false;setBusy(false)}}
  }
  function applyAccount(id:string, rows:Draft[]){
    if(id!==account){setLabel("INBOX");setPasswordOwner("");setGmailAuthorization(null);setMailActivity(null)}
    setAccount(id);setDrafts(rows);setEdit(blank());setDirty(false);setAttachmentRefresh(null);
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
    if(mailBusy || attachmentRefresh || !isCurrent() || !accounts.some(row=>row.id===id && (row.provider==="alibaba"||row.provider==="gmail")))return;
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
  useLayoutEffect(() => {
    const nextSource = { invoke };
    source.current = nextSource;
    lock.current = true;
    setBusy(true);
    setError("");
    setAccounts([]);
    setAccount("");
    setDrafts([]);
    setEdit(blank());
    setDirty(false);
    setAttachmentRefresh(null);
    setLabel("INBOX");
    setPasswordOwner("");
    setGmailAuthorization(null);
    setMailActivity(null);
    focusReply.current = undefined;
    attachmentFocus.current = null;
    void (async () => {
      try {
        const rows = await nextSource.invoke<Account[]>({ kind: "accounts" });
        if (source.current !== nextSource) return;
        const id = rows[0]?.id ?? "";
        const drafts = id ? await nextSource.invoke<Draft[]>({ kind: "drafts", account: id }) : [];
        if (source.current !== nextSource) return;
        setAccounts(rows);
        setAccount(id);
        setDrafts(drafts);
        setSearchVersion(version => version + 1);
      } catch {
        if (source.current === nextSource) setError(t("Could not access local mail data."));
      } finally {
        if (source.current === nextSource) {
          lock.current = false;
          setBusy(false);
        }
      }
    })();
    return () => { source.current = null; };
  }, [invoke]);
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
  useLayoutEffect(() => {
    const action = attachmentFocus.current;
    if (!action) return;
    if (action.account !== account || action.draftId !== edit.id) {
      attachmentFocus.current = null;
      return;
    }
    const { button } = action;
    const doc = button.ownerDocument;
    if (busy || mailBusy) {
      const focusMoved = (event: FocusEvent) => {
        if (event.target !== button && event.target !== doc.body) attachmentFocus.current = null;
      };
      doc.addEventListener("focusin", focusMoved);
      return () => doc.removeEventListener("focusin", focusMoved);
    }
    attachmentFocus.current = null;
    if (doc.activeElement !== doc.body && doc.activeElement !== button) return;
    const next = attachmentRefresh ? reloadDraftButton.current :
      button.isConnected && !button.matches(":disabled") ? button : addAttachmentButton.current;
    if (next && doc.activeElement !== next) next.focus();
  }, [account, edit.id, attachmentRefresh, busy, mailBusy]);
  const discard=async()=>!dirty||await window.confirm(t("Discard unsaved draft changes?"));
  function change(key:"recipient"|"subject"|"body",value:string){setEdit({...edit,[key]:value});setDirty(true)}
  async function readDraftAttachments(target: AttachmentRefresh, isCurrent: () => boolean) {
    try {
      const rows = await invoke<Draft[]>({kind:"drafts",account:target.account});
      if (!isCurrent()) return;
      const draft = rows.find(row => row.id === target.id);
      if (draft && (!Number.isSafeInteger(draft.revision) || draft.revision < target.revision)) throw Error("mail_conflict");
      setDrafts(rows);
      setEdit(draft ?? blank());
      setAttachmentRefresh(null);
    } catch {
      if (isCurrent()) setAttachmentRefresh(target);
    }
  }
  async function changeAttachment(isCurrent: () => boolean, attachment?:string) {
    if (!edit.id || attachmentRefresh) return;
    const result = await invoke<{changed:boolean;revision?:number}>({
      kind: attachment ? "removeAttachment" : "pickAttachment",
      account, id:edit.id, revision:edit.revision, ...(attachment ? {attachment} : {})
    });
    if (!result.changed || !isCurrent()) return;
    await readDraftAttachments({account, id:edit.id, revision:result.revision ?? edit.revision + 1}, isCurrent);
  }
  function startAttachment(button: HTMLButtonElement, attachment?: string) {
    void run(isCurrent => {
      if (edit.id && button.ownerDocument.activeElement === button) {
        attachmentFocus.current = { account, draftId: edit.id, button };
      }
      return changeAttachment(isCurrent, attachment);
    });
  }
  function reportGmailGrant(send: boolean, authorized = false) {
    setGmailAuthorization(current => {
      const previous = current?.account === account ? current : null;
      // A local status response after a canceled sign-in can still contain the old scope.
      if (previous?.loss && !authorized) return previous;
      const revision = previous?.revision ?? 0;
      return { account, send, revision: authorized ? revision + 1 : revision };
    });
  }
  function gmailGrantLost(loss: GmailGrantLoss) {
    // A prior send can finish after the user has already reauthorized this account.
    setGmailAuthorization(current =>
      current && current.account === account && current.revision === gmailAuthorization?.revision
        ? { ...current, send: false, loss: current.loss === "connection" ? "connection" : loss }
        : current);
  }
  const recoveringAttachments = attachmentRefresh !== null;
  const draftBlocked = busy || recoveringAttachments;
  const savedDraftReady = Boolean(edit.id) && !recoveringAttachments;
  return <section className="mail-local"><h2>{t("Mail")}</h2>
    {!alibaba&&!gmail&&<p>{t("Local drafts only. No mailbox is connected.")}</p>}
    <fieldset disabled={busy}><legend>{t("Mail accounts")}</legend>
    {accounts.length>0&&<label>{t("Mail account")}<select className="ui-select" value={account} disabled={accountSwitchBlocked} onChange={e=>{const id=e.target.value;void run(async()=>{if(await discard())await load(id)})}}>{accounts.map(a=><option value={a.id} key={a.id}>{a.address} · {a.provider==="gmail"?t("Gmail"):t("Alibaba Mail")}</option>)}</select></label>}
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{if(!await discard())return;
      const added=await invoke<{id:string}>({kind:"add",provider,address});
      setAccounts(await invoke<Account[]>({kind:"accounts"}));setAddress("");await load(added.id);
    })}}><label>{t("Mail provider")}<select className="ui-select" value={provider} disabled={mailBusy} onChange={e=>setProvider(e.target.value)}><option value="gmail">{t("Gmail")}</option><option value="alibaba">{t("Alibaba Mail")}</option></select></label>
    <label>{t("Email address")}<input className="ui-input" disabled={mailBusy} required type="email" value={address} onChange={e=>setAddress(e.target.value)} /></label>
    <button className="ui-button ui-button--primary" type="submit" disabled={mailBusy}>{t("Add local account")}</button></form></fieldset>
    {account&&<CachedMailSearch key={`search-${searchVersion}`} accounts={accounts} current={account} invoke={invoke} gmail={gmailTransport} alibaba={transport} onReply={replyFromCache} replyBlocked={draftBlocked||mailBusy}/>}
    {gmail&&owner&&<GmailInbox key={account} id={account} address={owner.address} label={label} setLabel={setLabel} invoke={gmail} onGrant={reportGmailGrant}
      grantLoss={gmailAuthorization?.account===account ? gmailAuthorization.loss : undefined} onReply={replyFromCache} draftBusy={draftBlocked}/>}
    {alibaba&&<AlibabaInbox key={account} id={account} folder={label} setFolder={setLabel} invoke={alibaba} discard={discard} onBusy={reportAlibabaBusy}
      onConfigured={v=>setPasswordOwner(v?account:"")} onReply={openReply} draftBusy={draftBlocked}/>}
    {account&&<fieldset disabled={busy||mailBusy}><legend>{t("Mail drafts")}</legend>
    {edit.gmailReply&&<p>{t("Changing the recipient or subject sends this as a new message.")}</p>}
    <div className="mail-list"><button className="ui-button" type="button" disabled={recoveringAttachments} onClick={()=>void run(async()=>{if(await discard()){setEdit(blank());setDirty(false)}})}>{t("New draft")}</button>
    <button className="ui-button" type="button" ref={reloadDraftButton} onClick={()=>void run(async isCurrent=>{
      if (attachmentRefresh) await readDraftAttachments(attachmentRefresh, isCurrent);
      else if(await discard()) await load(account);
    })}>{t(attachmentRefresh ? "Reload draft attachments" : "Reload drafts")}</button>
    {drafts.map(d=><button className="ui-button" key={d.id} type="button" disabled={recoveringAttachments} aria-pressed={edit.id===d.id} onClick={()=>void run(async()=>{if(await discard()){setEdit(d);setDirty(false)}})}>{d.subject||d.recipient||t("Untitled draft")}</button>)}</div>
    {attachmentRefresh&&<p role="alert">{t("Attachment change saved. Reload the draft attachments to continue.")}</p>}
    <label>{t("Recipient")}<input className="ui-input" disabled={recoveringAttachments} value={edit.recipient} onChange={e=>change("recipient",e.target.value)} /></label>
    <label>{t("Mail subject")}<input className="ui-input" disabled={recoveringAttachments} value={edit.subject} onChange={e=>change("subject",e.target.value)} /></label>
    <label>{t("Message body")}<textarea className="ui-textarea" id="studio-mail-compose-body" ref={composeBody} rows={8} disabled={recoveringAttachments} value={edit.body} onChange={e=>change("body",e.target.value)} /></label>
    <button className="ui-button" type="button" disabled={!dirty||recoveringAttachments} onClick={()=>void run(async()=>{
      const saved=await invoke<{id:string,revision:number}>({kind:"save",account,id:edit.id,revision:edit.revision,recipient:edit.recipient,subject:edit.subject,body:edit.body});const d={...edit,...saved};setEdit(d);setDirty(false);setDrafts(old=>[d,...old.filter(item=>item.id!==d.id)]);
    })}>{t("Save draft")}</button>
    {savedDraftReady && <div>
      <button className="ui-button" type="button" ref={addAttachmentButton} disabled={dirty} onClick={event=>startAttachment(event.currentTarget)}>{t("Add attachment")}</button>
      {edit.attachments?.map(file=><div key={file.id}>{file.name} ({file.size} B) <button className="ui-button" type="button" disabled={dirty} onClick={event=>startAttachment(event.currentTarget,file.id)}>{t("Remove attachment")}</button></div>)}
    </div>}
    {gmail&&owner&&savedDraftReady&&!dirty&&<MailDelivery key={JSON.stringify([account,edit.id,edit.revision])} provider="gmail" invoke={gmail} id={account} address={owner.address} draft={edit}
      configured={gmailAuthorization?.account===account && gmailAuthorization.send} onGmailGrantLost={gmailGrantLost}/>}
    {alibaba&&owner&&savedDraftReady&&!dirty&&<MailDelivery key={JSON.stringify([account,edit.id,edit.revision])} invoke={alibaba} id={account} address={owner.address} draft={edit} configured={passwordOwner===account}/>}
    {savedDraftReady&&<button className="ui-button" type="button" onClick={()=>{void run(async()=>{if(!await window.confirm(t("Delete this local draft?")))return;
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
