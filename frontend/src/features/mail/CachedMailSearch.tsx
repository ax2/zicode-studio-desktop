import { useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { Invoke } from "./index";

type Account = { id: string; address: string; provider: string };
type Hit = { account: string; address: string; provider: string; id: string; epoch: number | null; subject: string; sender: string };
type Page = { items: Hit[]; more: boolean };

export function CachedMailSearch({accounts, current, invoke, gmail, alibaba}: {
  accounts: Account[]; current: string; invoke: Invoke; gmail?: Invoke; alibaba?: Invoke;
}) {
  const [scope, setScope] = useState(current);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [reading, setReading] = useState<{hit: Hit; text?: string | null} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  function clear() {
    ++generation.current;
    setBusy(false);
    setPage(null);
    setReading(null);
    setError(false);
  }
  async function search(start: number) {
    const version = ++generation.current;
    setBusy(true);
    setError(false);
    setReading(null);
    try {
      const results = await invoke<Page>({kind:"search", account:scope || null, query:query.trim(), offset:start});
      if (version === generation.current) { setPage(results); setOffset(start); }
    } catch {
      if (version === generation.current) { setError(true); setPage(null); }
    } finally { if (version === generation.current) setBusy(false); }
  }
  async function open(hit: Hit) {
    const version = ++generation.current;
    setReading({hit});
    setError(false);
    setBusy(true);
    try {
      let text: string | null = null;
      if (hit.provider === "gmail" && gmail) {
        const body = await gmail<{plainText:string | null} | null>({kind:"cachedBody", accountId:hit.account, id:hit.id});
        text = body?.plainText ?? null;
      } else if (hit.provider === "alibaba" && alibaba) {
        const body = await alibaba<{text:string}>({kind:"cachedBody", accountId:hit.account, uidValidity:hit.epoch, uid:Number(hit.id)});
        text = body.text;
      }
      if (version === generation.current) setReading({hit,text});
    } catch(e) {
      if (version === generation.current) {
        setReading({hit,text:null});
        if (!String(e).includes("mail_cache_empty")) setError(true);
      }
    } finally { if (version === generation.current) setBusy(false); }
  }
  return <fieldset><legend>{t("Search cached inboxes")}</legend>
    <form onSubmit={e=>{e.preventDefault(); if(query.trim()) void search(0)}}>
      <label>{t("Search scope")}<select value={scope} onChange={e=>{clear();setScope(e.target.value)}}>
        {accounts.map(a=><option key={a.id} value={a.id}>{a.address} · {a.provider==="gmail"?t("Gmail"):t("Alibaba Mail")}</option>)}
        <option value="">{t("All local mail accounts")}</option>
      </select></label>
      <label>{t("Search cached mail")}<input type="search" maxLength={128} value={query} onChange={e=>{clear();setQuery(e.target.value)}}/></label>
      <button type="submit" disabled={busy || !query.trim()}>{t("Search")}</button>
    </form>
    {error && <p role="alert">{t("Could not access local mail data.")}</p>}
    {page && <>
      {!page.items.length && <p role="status">{t("No matching cached messages.")}</p>}
      <ul className="mail-inbox-list">{page.items.map(hit=><li key={JSON.stringify([hit.account,hit.epoch,hit.id])}>
        <button type="button" onClick={()=>void open(hit)}><strong translate="no">{hit.subject || t("No subject")}</strong>
          <small translate="no">{hit.sender} · {hit.address}</small></button></li>)}</ul>
      {offset>0 && <button type="button" disabled={busy} onClick={()=>void search(offset-40)}>{t("Previous")}</button>}
      {page.more && <button type="button" disabled={busy} onClick={()=>void search(offset+40)}>{t("Next")}</button>}
    </>}
    {reading && <article aria-label={t("Cached message")}><h3 translate="no">{reading.hit.subject||t("No subject")}</h3>
      <p translate="no">{reading.hit.sender} · {reading.hit.address}</p>
      {reading.text===null && <p>{t("This message is not available offline. Download it explicitly to read it.")}</p>}
      {typeof reading.text==="string" && <pre translate="no" className="mail-read-body">{reading.text||t("Empty message")}</pre>}
    </article>}
  </fieldset>;
}
