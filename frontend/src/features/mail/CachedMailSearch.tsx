import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { MailAttachments } from "./MailAttachments";
import { MailBody } from "./MailBody";
import { searchBodyAccess, type SearchMailBody } from "./mail-search-body";
import type { Invoke } from "./index";

type Account = { id: string; address: string; provider: string };
type Hit = { folder?:string; account: string; address: string; provider: string; id: string; epoch: number | null; subject: string; sender: string };
type Page = { items: Hit[]; more: boolean };
type Reading = { hit: Hit } & (
  { status: "loading" } | { status: "missing"; error?: string } |
  { status: "failed"; error: string } | { status: "ready"; body: SearchMailBody }
);

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
  const readingRequest = useRef<{ hit: Hit; pending: boolean; canDownload: boolean } | null>(null);
  const readingAccess = reading && searchBodyAccess(reading.hit, gmail, alibaba);
  const loadingBody = reading?.status === "loading";
  const updatedAccounts = useRef(new Set<string>());
  const requestedOffset = useRef<number | null>(null);
  const previousLabel = useRef(label);
  useEffect(() => () => {
    ++searchGeneration.current;
    readingRequest.current = null;
  }, []);

  const closeReading = useCallback((account?: string) => {
    if (account && readingRequest.current?.hit.account !== account) return;
    readingRequest.current = null;
    setReading(null);
  }, []);
  const clear=useCallback(()=>{
    requestedOffset.current = null;
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
    requestedOffset.current = start;
    const version = ++searchGeneration.current;
    setBusy(true);
    setError(false);
    if (!background) {
      updatedAccounts.current.clear();
      closeReading();
    }
    try {
      const readPage = (position: number) => invoke<Page>({
        kind: "search", account: scope || null, ...(labelOnly && scope === current && label ? { label } : {}),
        query: query.trim(), offset: position,
      });
      let results = await readPage(start);
      if (version !== searchGeneration.current) return;
      let nextOffset = start;
      if (start > 0 && !results.items.length) {
        // A cache change can remove all results from the requested page.
        nextOffset = 0;
        results = await readPage(nextOffset);
        if (version !== searchGeneration.current) return;
      }
      const selected = readingRequest.current?.hit;
      if (selected && updatedAccounts.current.has(selected.account) && !results.items.some(hit => isSameMessage(hit, selected))) {
        closeReading();
      }
      updatedAccounts.current.clear();
      requestedOffset.current = nextOffset;
      setPage(results);
      setOffset(nextOffset);
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
      const pageOffset = requestedOffset.current;
      if (pageOffset === null || !account || (scope && scope !== account)) return;
      if (event.type === "studio-mail-cache-cleared") {
        setPage(previous => previous && { ...previous, items: previous.items.filter(hit => hit.account !== account) });
        closeReading(account);
      } else {
        updatedAccounts.current.add(account);
      }
      void search(pageOffset, true);
    }
    window.addEventListener("studio-mail-cache-cleared",cacheChanged);
    window.addEventListener("studio-mail-cache-updated",cacheChanged);
    return ()=>{
      window.removeEventListener("studio-mail-cache-cleared",cacheChanged);
      window.removeEventListener("studio-mail-cache-updated",cacheChanged);
    };
  },[scope,search,closeReading]);
  async function open(hit: Hit, download = false) {
    const previous = readingRequest.current;
    if (download && (previous?.hit !== hit || !previous.canDownload)) return;
    if (previous?.pending && isSameMessage(previous.hit, hit)) return;
    const request = { hit, pending: true, canDownload: false };
    readingRequest.current = request;
    const access = searchBodyAccess(hit, gmail, alibaba);
    if (!access) {
      request.pending = false;
      setReading({ hit, status: "missing" });
      return;
    }
    setReading({ hit, status: "loading" });
    try {
      const body = await access.read(download);
      if (readingRequest.current !== request) return;
      request.canDownload = !body;
      setReading(body ? { hit, status: "ready", body } : { hit, status: "missing" });
    } catch (reason) {
      if (readingRequest.current !== request) return;
      request.canDownload = download;
      const message = download ? access.error(reason) : t("Could not access local mail data.");
      setReading({ hit, status: download ? "missing" : "failed", error: message });
    } finally {
      request.pending = false;
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
      <button className="ui-button" type="submit" disabled={busy || loadingBody || !query.trim()}>{t("Search")}</button>
    </form>
    {error && <p role="alert">{t("Could not access local mail data.")}</p>}
    {page && <>
      {!page.items.length && <p role="status">{t("No matching cached messages.")}</p>}
      <ul className="mail-inbox-list">{page.items.map(hit=><li key={JSON.stringify([hit.account,hit.folder,hit.epoch,hit.id])}>
        <button className="ui-button" type="button" onClick={()=>void open(hit)}><strong translate="no">{hit.subject || t("No subject")}</strong>
          <small translate="no">{hit.sender} · {hit.address}</small></button></li>)}</ul>
      {offset>0 && <button className="ui-button" type="button" disabled={busy || loadingBody} onClick={()=>void search(offset-40)}>{t("Previous")}</button>}
      {page.more && <button className="ui-button" type="button" disabled={busy || loadingBody} onClick={()=>void search(offset+40)}>{t("Next")}</button>}
    </>}
    {reading && <article aria-label={t("Cached message")} aria-busy={loadingBody}><h3 translate="no">{reading.hit.subject||t("No subject")}</h3>
      <p translate="no">{reading.hit.sender} · {reading.hit.address}</p>
      {reading.status === "loading" && <p role="status">{t("Loading…")}</p>}
      {(reading.status === "failed" || reading.status === "missing") && reading.error && <p role="alert">{reading.error}</p>}
      {reading.status === "missing" && <>
        <p>{t(readingAccess ? "This message is not available offline. Download it explicitly to read it." : "No message body is saved on this device.")}</p>
        {readingAccess && <button className="ui-button" type="button" onClick={() => void open(reading.hit, true)}>
          {t("Download message body")}
        </button>}
      </>}
      {reading.status === "ready" && <>
        {reading.body.bodyLimited && <p>{t("Some message text exceeds the reading limit.")}</p>}
        <MailBody text={reading.body.text} html={reading.body.html}/>
        {readingAccess && <MailAttachments key={JSON.stringify(readingAccess.message)} items={reading.body.attachments}
          invoke={readingAccess.invoke} message={readingAccess.message}/>}
      </>}
    </article>}
  </fieldset>;
}
