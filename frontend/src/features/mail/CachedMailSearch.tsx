import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { MailAttachments } from "./MailAttachments";
import { type CreateMailReply, gmailReplyNeedsRefresh } from "./GmailInbox";
import { MailBody } from "./MailBody";
import { searchBodyAccess, type SearchMailBody } from "./mail-search-body";
import type { Invoke } from "./index";

type Account = { id: string; address: string; provider: string };
type Folder = { id: string; name: string };
type Hit = { folder?: string | null; account: string; address: string; provider: string; id: string; epoch: number | null; subject: string; sender: string };
type Page = { items: Hit[]; more: boolean };
type Reading = { hit: Hit; refreshing?: boolean } & (
  { status: "loading" } | { status: "missing"; error?: string } |
  { status: "failed"; error: string } | { status: "ready"; body: SearchMailBody }
);

function isSameMessage(left: Hit, right: Hit): boolean {
  return left.account === right.account && left.provider === right.provider && left.folder === right.folder &&
    left.epoch === right.epoch && left.id === right.id;
}

export function CachedMailSearch({accounts, current, invoke, gmail, alibaba, onReply, replyBlocked = false}: {
  accounts: Account[]; current: string; invoke: Invoke; gmail?: Invoke; alibaba?: Invoke;
  onReply?: CreateMailReply;
  replyBlocked?: boolean;
}) {
  const [scope, setScope] = useState(current);
  const [folder, setFolder] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const directoryGeneration = useRef(0);
  const provider = accounts.find(account => account.id === scope)?.provider;
  const directoryInvoke = provider === "gmail" ? gmail : provider === "alibaba" ? alibaba : undefined;
  const directoryKind = provider === "gmail" ? "cachedLabels" : "cachedFolders";
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [reading, setReading] = useState<Reading | null>(null);
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<{message:string; refresh?:boolean} | null>(null);
  const replyPending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const searchGeneration = useRef(0);
  const readingRequest = useRef<{ hit: Hit; pending: boolean; canDownload: boolean } | null>(null);
  const readingAccess = reading && searchBodyAccess(reading.hit, gmail, alibaba);
  const loadingBody = reading?.status === "loading" || reading?.refreshing === true;
  const paginationBlocked = busy || loadingBody;
  const updatedAccounts = useRef(new Set<string>());
  const requestedOffset = useRef<number | null>(null);
  const displayedOffset = useRef<number | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const firstResult = useRef<HTMLButtonElement>(null);
  const paginationFocus = useRef<HTMLButtonElement | null>(null);
  const readingHeading = useRef<HTMLHeadingElement>(null);
  const openedResult = useRef<{button: HTMLButtonElement; focusPending: boolean} | null>(null);
  useLayoutEffect(() => {
    const button = paginationFocus.current;
    paginationFocus.current = null;
    if (!button || button.isConnected) return;
    const owner = button.ownerDocument;
    if (owner.activeElement !== owner.body) return;
    (firstResult.current ?? queryInput.current)?.focus();
  });
  useLayoutEffect(() => {
    const result = openedResult.current;
    if (!reading || !result?.focusPending) return;
    result.focusPending = false;
    if (result.button.ownerDocument.activeElement === result.button) readingHeading.current?.focus();
  }, [reading]);
  useEffect(() => () => {
    ++searchGeneration.current;
    readingRequest.current = null;
  }, []);

  const closeReading = useCallback((account?: string) => {
    if (account && readingRequest.current?.hit.account !== account) return;
    readingRequest.current = null;
    openedResult.current = null;
    setReading(null);
    setReplyError(null);
  }, []);
  const clear=useCallback(()=>{
    requestedOffset.current = null;
    displayedOffset.current = null;
    paginationFocus.current = null;
    ++searchGeneration.current;
    updatedAccounts.current.clear();
    setBusy(false);
    setPage(null);
    closeReading();
    setError(false);
  },[closeReading]);
  const readDirectory = useCallback(async () => {
    if (!directoryInvoke) return;
    const request = ++directoryGeneration.current;
    setDirectoryLoading(true);
    try {
      const rows = await directoryInvoke<Folder[] | null>({ kind: directoryKind, accountId: scope });
      if (request !== directoryGeneration.current) return;
      setFolders(Array.isArray(rows) ? rows : []);
      setDirectoryFailed(false);
    } catch {
      if (request === directoryGeneration.current) setDirectoryFailed(true);
    } finally {
      if (request === directoryGeneration.current) setDirectoryLoading(false);
    }
  }, [directoryInvoke, directoryKind, scope]);
  useEffect(() => {
    if (!directoryInvoke) return;
    function directoryChanged(event: Event) {
      if ((event as CustomEvent<string>).detail !== scope) return;
      if (event.type === "studio-mail-cache-cleared") setFolders([]);
      void readDirectory();
    }
    void readDirectory();
    window.addEventListener("studio-mail-directory-updated", directoryChanged);
    window.addEventListener("studio-mail-cache-cleared", directoryChanged);
    return () => {
      ++directoryGeneration.current;
      window.removeEventListener("studio-mail-directory-updated", directoryChanged);
      window.removeEventListener("studio-mail-cache-cleared", directoryChanged);
    };
  }, [scope, directoryInvoke, readDirectory]);
  function changeScope(next: string) {
    ++directoryGeneration.current;
    clear();
    setFolder("");
    setFolders([]);
    setDirectoryFailed(false);
    setDirectoryLoading(false);
    setScope(next);
  }
  useEffect(() => {
    if (folder && folder !== "INBOX" && !folders.some(item => item.id === folder)) {
      setFolder("");
      clear();
    }
  }, [folder, folders, clear]);
  const search = useCallback(async (start: number, background = false, button?: HTMLButtonElement) => {
    requestedOffset.current = start;
    const version = ++searchGeneration.current;
    setBusy(true);
    setError(false);
    if (!background) updatedAccounts.current.clear();
    try {
      const readPage = (position: number) => invoke<Page>({
        kind: "search", account: scope || null, ...(folder ? { label: folder } : {}),
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
      const changedPage = nextOffset !== displayedOffset.current;
      const selectedWasRemoved = selected && updatedAccounts.current.has(selected.account) &&
        !results.items.some(hit => isSameMessage(hit, selected));
      if (!background || changedPage || selectedWasRemoved) closeReading();
      updatedAccounts.current.clear();
      displayedOffset.current = nextOffset;
      requestedOffset.current = nextOffset;
      paginationFocus.current = button && button.ownerDocument.activeElement === button ? button : null;
      setPage(results);
      setOffset(nextOffset);
    } catch {
      if (version === searchGeneration.current) {
        requestedOffset.current = displayedOffset.current;
        setError(true);
      }
    } finally { if (version === searchGeneration.current) setBusy(false); }
  }, [invoke, scope, query, folder, closeReading]);
  function navigatePage(start: number, button: HTMLButtonElement) {
    if (paginationBlocked || requestedOffset.current !== displayedOffset.current) return;
    void search(start, false, button);
  }
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
  async function open(
    hit: Hit,
    action: "cache" | "download" | "reply-refresh" = "cache",
    resultButton?: HTMLButtonElement,
  ) {
    const previous = readingRequest.current;
    const download = action !== "cache";
    const replyRefresh = action === "reply-refresh";
    const original = replyRefresh && reading?.hit === hit ? reading : null;
    if (download && (previous?.hit !== hit || (replyRefresh ? !original || !replyError?.refresh : !previous.canDownload))) return;
    if (previous?.pending && isSameMessage(previous.hit, hit)) return;
    const request = { hit, pending: true, canDownload: false };
    if (resultButton) openedResult.current = { button: resultButton, focusPending: true };
    readingRequest.current = request;
    if (!original) setReplyError(null);
    const access = searchBodyAccess(hit, gmail, alibaba);
    if (!access) {
      request.pending = false;
      setReading({ hit, status: "missing" });
      return;
    }
    setReading(original ? { ...original, refreshing: true } : { hit, status: "loading" });
    try {
      const body = await access.read(download);
      if (readingRequest.current !== request) return;
      if (original && !body) throw Error("gmail_reply_metadata_missing");
      request.canDownload = !body;
      if (original) setReplyError(null);
      setReading(body ? { hit, status: "ready", body } : { hit, status: "missing" });
    } catch (reason) {
      if (readingRequest.current !== request) return;
      const message = download ? access.error(reason) : t("Could not access local mail data.");
      if (original) {
        request.canDownload = previous?.canDownload ?? false;
        setReading(original);
        setReplyError({ message, refresh: true });
      } else {
        request.canDownload = download;
        setReading({ hit, status: download ? "missing" : "failed", error: message });
      }
    } finally {
      request.pending = false;
    }
  }
  function returnToResults() {
    const button = openedResult.current?.button;
    (button?.isConnected ? button : queryInput.current)?.focus();
    closeReading();
  }
  async function replyToReading() {
    const source = readingRequest.current;
    if (replyBlocked || replyPending.current || !reading || source?.hit !== reading.hit ||
        !onReply || !readingAccess?.replyDraft || source.pending) return;
    const isCurrent = () => readingRequest.current === source;
    replyPending.current = true;
    setReplying(true);
    setReplyError(null);
    try {
      await onReply(reading.hit.account, readingAccess.replyDraft, isCurrent);
    } catch (reason) {
      if (!isCurrent()) return;
      const sourceUnavailable = /^(?:Error:\s*)?mail_(?:cache_empty|inbox_changed)$/.test(String(reason));
      setReplyError({
        message: sourceUnavailable ? t("This cached message is unavailable. Search again before replying.") : readingAccess.error(reason),
        refresh: reading.hit.provider === "gmail" && gmailReplyNeedsRefresh(reason),
      });
    } finally {
      replyPending.current = false;
      setReplying(false);
    }
  }
  return <fieldset><legend>{t("Search cached inboxes")}</legend>
    <form onSubmit={e=>{e.preventDefault(); if(query.trim()) void search(0)}}>
      <label>{t("Search scope")}<select className="ui-select" value={scope} onChange={e => changeScope(e.target.value)}>
        {accounts.map(a=><option key={a.id} value={a.id}>{a.address} · {a.provider==="gmail"?t("Gmail"):t("Alibaba Mail")}</option>)}
        <option value="">{t("All local mail accounts")}</option>
      </select></label>
      {scope && <label>{t(provider === "gmail" ? "Search Gmail label" : "Search IMAP folder")}
        <select className="ui-select" value={folder} onChange={e => { clear(); setFolder(e.target.value); }}>
          <option value="">{t(provider === "gmail" ? "All Gmail labels" : "All folders")}</option>
          <option value="INBOX">{t("Inbox")}</option>
          {folders.filter(item => item.id !== "INBOX").map(item =>
            <option key={item.id} value={item.id} translate="no">{item.name}</option>)}
        </select>
      </label>}
      {directoryFailed && <>
        <p role="status">{t("Could not read saved labels or folders.")}</p>
        <button className="ui-button" type="button" disabled={directoryLoading} onClick={() => void readDirectory()}>
          {t("Retry saved labels or folders")}
        </button>
      </>}
      <label>{t("Search cached mail")}<input ref={queryInput} className="ui-input" type="search" maxLength={128} value={query} onChange={e=>{clear();setQuery(e.target.value)}}/></label>
      <button className="ui-button" type="submit" disabled={busy || loadingBody || !query.trim()}>{t("Search")}</button>
    </form>
    {busy && <p role="status">{t("Searching messages…")}</p>}
    {error && <p role="alert">{t("Could not access local mail data.")}</p>}
    {page && <>
      {!page.items.length && <p role="status">{t("No matching cached messages.")}</p>}
      <ul className="mail-inbox-list">{page.items.map((hit, index)=><li key={JSON.stringify([hit.account,hit.folder,hit.epoch,hit.id])}>
        <button ref={index === 0 ? firstResult : undefined} className="ui-button" type="button" aria-pressed={Boolean(reading && isSameMessage(reading.hit, hit))}
          onClick={event => void open(hit, "cache", event.currentTarget)}><strong translate="no">{hit.subject || t("No subject")}</strong>
          <small translate="no">{hit.sender} · {hit.address}{hit.folder && <> · {hit.folder === "INBOX" ? t("Inbox") : hit.folder}</>}</small>
        </button></li>)}</ul>
      {offset>0 && <button className="ui-button" type="button" aria-disabled={paginationBlocked || undefined} onClick={event => navigatePage(offset - 40, event.currentTarget)}>{t("Previous")}</button>}
      {page.more && <button className="ui-button" type="button" aria-disabled={paginationBlocked || undefined} onClick={event => navigatePage(offset + 40, event.currentTarget)}>{t("Next")}</button>}
    </>}
    {reading && <article aria-label={t("Cached message")} aria-busy={loadingBody || replying}>
      <h3 ref={readingHeading} tabIndex={-1} translate="no">{reading.hit.subject||t("No subject")}</h3>
      <button className="ui-button" type="button" onClick={returnToResults}>{t("Back to search results")}</button>
      <p translate="no">{reading.hit.sender} · {reading.hit.address}</p>
      {reading.status === "loading" && <p role="status">{t("Loading…")}</p>}
      {(reading.status === "failed" || reading.status === "missing") && reading.error && <p role="alert">{reading.error}</p>}
      {reading.status === "failed" && readingAccess && <button className="ui-button" type="button" onClick={() => {
        if (readingRequest.current?.hit === reading.hit) void open(reading.hit);
      }}>{t("Try again")}</button>}
      {reading.status === "missing" && <>
        <p>{t(readingAccess ? "This message is not available offline. Download it explicitly to read it." : "No message body is saved on this device.")}</p>
        {readingAccess && !replyError?.refresh && <button className="ui-button" type="button" onClick={() => void open(reading.hit, "download")}>
          {t("Download message body")}
        </button>}
      </>}
      {reading.status === "ready" && <>
        {reading.body.bodyLimited && <p>{t("Some message text exceeds the reading limit.")}</p>}
        <MailBody text={reading.body.text} html={reading.body.html}/>
        {readingAccess && <MailAttachments key={JSON.stringify(readingAccess.message)} items={reading.body.attachments}
          invoke={readingAccess.invoke} message={readingAccess.message}/>}
      </>}
      {onReply && readingAccess?.replyDraft && (reading.status === "ready" || reading.status === "missing") &&
        <button className="ui-button" type="button" disabled={loadingBody || replying || replyBlocked} onClick={() => void replyToReading()}>
          {t("Create reply draft")}
        </button>}
      {replying && <p role="status">{t("Saving…")}</p>}
      {replyError && <p role="alert">{replyError.message}</p>}
      {replyError?.refresh && readingAccess && <button className="ui-button" type="button" disabled={loadingBody || replying || replyBlocked} onClick={() => void open(reading.hit, "reply-refresh")}>
        {t("Refresh message to reply")}
      </button>}
    </article>}
  </fieldset>;
}
