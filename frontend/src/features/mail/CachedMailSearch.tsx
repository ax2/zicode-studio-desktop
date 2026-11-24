import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { MailAttachments, type Attachment } from "./MailAttachments";
import { MailBody } from "./MailBody";
import type { Invoke } from "./index";

type Account = { id: string; address: string; provider: string };
type Hit = { folder?:string; account: string; address: string; provider: string; id: string; epoch: number | null; subject: string; sender: string };
type Page = { items: Hit[]; more: boolean };
type Reading = { hit: Hit; loading?: boolean; failed?: boolean; text?: string | null; html?: string | null; attachments?: Attachment[]; bodyLimited?: boolean };

function isSameMessage(left: Hit, right: Hit): boolean {
  return left.account === right.account && left.provider === right.provider && left.folder === right.folder &&
    left.epoch === right.epoch && left.id === right.id;
}

export function CachedMailSearch({accounts, current, invoke, gmail, alibaba, label}: {
  accounts: Account[]; current: string; invoke: Invoke; gmail?: Invoke; alibaba?: Invoke; label?:string;
}) {
  const [scope, setScope] = useState(current);
  const [labelOnly,setLabelOnly]=useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const searchGeneration = useRef(0);
  const readingRequest = useRef<{ hit: Hit } | null>(null);
  const updatedAccounts = useRef(new Set<string>());
  const submitted = useRef(false);
  const previousLabel = useRef(label);

  const closeReading = useCallback((account?: string) => {
    if (account && readingRequest.current?.hit.account !== account) return;
    readingRequest.current = null;
    setReading(null);
  }, []);
  const clear=useCallback(()=>{
    submitted.current = false;
    ++searchGeneration.current;
    updatedAccounts.current.clear();
    setBusy(false);
    setPage(null);
    closeReading();
    setError(false);
  },[closeReading]);
  useEffect(()=>{
    if(previousLabel.current!==label && labelOnly) clear();
    previousLabel.current=label;
  },[label,labelOnly,clear]);
  const search = useCallback(async (start: number, background = false) => {
    submitted.current = true;
    const version = ++searchGeneration.current;
    setBusy(true);
    setError(false);
    if (!background) {
      updatedAccounts.current.clear();
      closeReading();
    }
    try {
      const results = await invoke<Page>({kind:"search", account:scope || null, ...(labelOnly && scope===current && label ? {label} : {}), query:query.trim(), offset:start});
      if (version !== searchGeneration.current) return;
      const selected = readingRequest.current?.hit;
      if (selected && updatedAccounts.current.has(selected.account) && !results.items.some(hit => isSameMessage(hit, selected))) {
        closeReading();
      }
      updatedAccounts.current.clear();
      setPage(results);
      setOffset(start);
    } catch {
      if (version === searchGeneration.current) {
        setError(true);
        if (!background) setPage(null);
      }
    } finally { if (version === searchGeneration.current) setBusy(false); }
  }, [invoke, scope, query, labelOnly, current, label, closeReading]);
  useEffect(()=>{
    function cacheChanged(event:Event) {
      const account=(event as CustomEvent<string>).detail;
      if (!submitted.current || !account || (scope && scope !== account)) return;
      if (event.type === "studio-mail-cache-cleared") {
        setPage(previous => previous && { ...previous, items: previous.items.filter(hit => hit.account !== account) });
        closeReading(account);
      } else {
        updatedAccounts.current.add(account);
      }
      void search(0, true);
    }
    window.addEventListener("studio-mail-cache-cleared",cacheChanged);
    window.addEventListener("studio-mail-cache-updated",cacheChanged);
    return ()=>{
      window.removeEventListener("studio-mail-cache-cleared",cacheChanged);
      window.removeEventListener("studio-mail-cache-updated",cacheChanged);
    };
  },[scope,search,closeReading]);
  async function open(hit: Hit) {
    const request = { hit };
    readingRequest.current = request;
    setReading({ hit, loading: true });
    try {
      let text: string | null = null;
      let html: string | null = null;
      let attachments: Attachment[] | undefined;
      let bodyLimited = false;
      if (hit.provider === "gmail" && gmail) {
        const body = await gmail<{plainText:string | null;html?:string;attachments?:Attachment[]} | null>({kind:"cachedBody", accountId:hit.account, id:hit.id});
        text = body?.plainText ?? null;
        html = body?.html ?? null;
        attachments = body?.attachments;
      } else if (hit.provider === "alibaba" && alibaba) {
        const body = await alibaba<{text:string;html?:string;attachments?:Attachment[];bodyLimited?:boolean}>({kind:"cachedBody", accountId:hit.account, ...(hit.folder?{folder:hit.folder}:{}), uidValidity:hit.epoch, uid:Number(hit.id)});
        text = body.text;
        html = body.html ?? null;
        attachments = body.attachments;
        bodyLimited = !!body.bodyLimited;
      }
      if (readingRequest.current === request) setReading({hit,text,html,attachments,bodyLimited});
    } catch(e) {
      if (readingRequest.current === request) {
        setReading({ hit, text: null, failed: !String(e).includes("mail_cache_empty") });
      }
    }
  }
  return <fieldset><legend>{t("Search cached inboxes")}</legend>
    <form onSubmit={e=>{e.preventDefault(); if(query.trim()) void search(0)}}>
      <label>{t("Search scope")}<select className="ui-select" value={scope} onChange={e=>{clear();setLabelOnly(false);setScope(e.target.value)}}>
        {accounts.map(a=><option key={a.id} value={a.id}>{a.address} · {a.provider==="gmail"?t("Gmail"):t("Alibaba Mail")}</option>)}
        <option value="">{t("All local mail accounts")}</option>
      </select></label>
      {label && scope===current && <label><input type="checkbox" checked={labelOnly} onChange={e=>{clear();setLabelOnly(e.target.checked)}}/>{t(accounts.find(a=>a.id===current)?.provider==="gmail"?"Search only the selected Gmail label":"Search only the selected folder")}</label>}
      <label>{t("Search cached mail")}<input className="ui-input" type="search" maxLength={128} value={query} onChange={e=>{clear();setQuery(e.target.value)}}/></label>
      <button className="ui-button" type="submit" disabled={busy || reading?.loading || !query.trim()}>{t("Search")}</button>
    </form>
    {error && <p role="alert">{t("Could not access local mail data.")}</p>}
    {page && <>
      {!page.items.length && <p role="status">{t("No matching cached messages.")}</p>}
      <ul className="mail-inbox-list">{page.items.map(hit=><li key={JSON.stringify([hit.account,hit.folder,hit.epoch,hit.id])}>
        <button className="ui-button" type="button" onClick={()=>void open(hit)}><strong translate="no">{hit.subject || t("No subject")}</strong>
          <small translate="no">{hit.sender} · {hit.address}</small></button></li>)}</ul>
      {offset>0 && <button className="ui-button" type="button" disabled={busy || reading?.loading} onClick={()=>void search(offset-40)}>{t("Previous")}</button>}
      {page.more && <button className="ui-button" type="button" disabled={busy || reading?.loading} onClick={()=>void search(offset+40)}>{t("Next")}</button>}
    </>}
    {reading && <article aria-label={t("Cached message")} aria-busy={reading.loading}><h3 translate="no">{reading.hit.subject||t("No subject")}</h3>
      <p translate="no">{reading.hit.sender} · {reading.hit.address}</p>
      {reading.loading && <p role="status">{t("Loading…")}</p>}
      {reading.failed && <p role="alert">{t("Could not access local mail data.")}</p>}
      {reading.text===null && !reading.html && <p>{t("This message is not available offline. Download it explicitly to read it.")}</p>}
      {(typeof reading.text==="string" || reading.html) && <MailBody text={reading.text ?? null} html={reading.html}/>}
      {reading.bodyLimited && <p>{t("Some message text exceeds the reading limit.")}</p>}
      <MailAttachments key={JSON.stringify([reading.hit.account,reading.hit.folder,reading.hit.epoch,reading.hit.id])} items={reading.attachments}
        invoke={reading.hit.provider==="gmail"?gmail:alibaba} message={reading.hit.provider==="gmail"
          ? {accountId:reading.hit.account,id:reading.hit.id}
          : {accountId:reading.hit.account,folder:reading.hit.folder,uidValidity:reading.hit.epoch!,uid:Number(reading.hit.id)}}/>
    </article>}
  </fieldset>;
}
