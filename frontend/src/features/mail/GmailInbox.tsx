import { MailAttachments, type Attachment } from "./MailAttachments";
import { MailBody } from "./MailBody";
import {MailDisconnect} from "./MailDisconnect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { Draft, Invoke } from "./index";

export type CreateMailReply = (account: string, create: () => Promise<Draft>, isCurrent: () => boolean) => Promise<void>;
export type GmailGrantLoss = "connection" | "sending";

export function gmailReplyNeedsRefresh(reason: unknown): boolean {
  return String(reason).replace(/^Error:\s*/, "") === "gmail_reply_metadata_missing";
}

type Grant = { connected: boolean; read?: boolean; send?: boolean; needsReconnect?: boolean };
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
    case "gmail_reply_metadata_missing":return t("Refresh this Gmail message before replying.");
    case "gmail_reply_unavailable":return t("This Gmail message has no valid reply address or thread information.");
    case "gmail_draft_changed":return t("Draft changed in another window. Reload before editing.");
    case "gmail_page_expired":return t("This mail page expired. Refresh from the server to continue.");
    case "gmail_rate_limited":return t("Google has limited requests. Try again later.");
    case "gmail_network":return t("Could not connect to the mail server. Your local data is unchanged.");
    case "gmail_storage":return t("Could not access local mail data.");
    default:return t("Mail operation failed. Check the account and try again.");
  }
}
export function GmailInbox({id,address,label,setLabel,invoke,onGrant,onReply,draftBusy=false,grantLoss}:{
  id:string;address:string;label:string;setLabel:(label:string)=>void;invoke:Invoke;onGrant:(send:boolean,authorized?:boolean)=>void;
  onReply?:CreateMailReply;draftBusy?:boolean;grantLoss?:GmailGrantLoss;
}) {
  const [savedGrant,setGrant]=useState<Grant>(none),[page,setPage]=useState<Page|null>(null);
  const grant = grantLoss === "connection" ? none :
    grantLoss === "sending" ? { ...savedGrant, send: false } : savedGrant;
  const [labels,setLabels]=useState<Label[]>([]);
  const [cachedLabelsFailed, setCachedLabelsFailed] = useState(false);
  const [message,setMessage]=useState<Message|null>(null),[body,setBody]=useState<Body|null>(null);
  const [localBodyFailed, setLocalBodyFailed] = useState(false);
  const [replyRefresh,setReplyRefresh]=useState(false);
  const [serverPage,setServerPage]=useState(false),[busy,setBusy]=useState("init"),[notice,setNotice]=useState("");
  const [expiredCursor, setExpiredCursor] = useState<string | null>(null);
  const epoch=useRef(0),operation=useRef("init"),grantCallback=useRef(onGrant);
  grantCallback.current=onGrant;
  const primaryAuthorization = useRef<HTMLButtonElement>(null);
  const cancelOperation = useRef<HTMLButtonElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const operationFocus = useRef<{ origin: HTMLButtonElement; kind: string; cancel?: HTMLButtonElement } | undefined>(undefined);
  useLayoutEffect(() => {
    const request = operationFocus.current;
    if (!request) return;
    const { activeElement, body } = request.origin.ownerDocument;
    if (activeElement !== request.origin && activeElement !== request.cancel && activeElement !== body) {
      operationFocus.current = undefined;
      return;
    }
    if (busy === request.kind && cancelOperation.current && !request.cancel) {
      request.cancel = cancelOperation.current;
      request.cancel.focus({ preventScroll: true });
    } else if (!busy) {
      operationFocus.current = undefined;
      const fallback = request.kind === "refresh" ? refreshButton.current : primaryAuthorization.current;
      const action = request.origin.isConnected ? request.origin : fallback;
      if (action && !action.matches(":disabled")) action.focus({ preventScroll: true });
    }
  });
  const saveGrant=(g:Grant,authorized?:boolean)=>{setGrant(g);grantCallback.current(Boolean(g.connected&&g.send),authorized)};
  useEffect(()=>{
    const gen=++epoch.current;
    operationFocus.current = undefined;
    operation.current="init"; setBusy("init");setGrant(none);grantCallback.current(false);
    setPage(null);setMessage(null);setBody(null);setServerPage(false);setNotice("");
    setExpiredCursor(null);
    setLabels([]);setCachedLabelsFailed(false);setLabel("INBOX");
    void Promise.allSettled([
      invoke<Grant>({kind:"status",accountId:id}),
      invoke<Page|null>({kind:"cachedPage",accountId:id,cursor:null,limit:20}),
      invoke<Label[]|null>({kind:"cachedLabels",accountId:id}),
    ]).then(([s,p,l])=>{
      if(epoch.current!==gen)return;
      if(l.status==="fulfilled"&&Array.isArray(l.value))setLabels(l.value);
      setCachedLabelsFailed(l.status === "rejected");
      if(s.status==="fulfilled"){setGrant(s.value);grantCallback.current(s.value.connected&&s.value.send===true)}else setNotice(gmailError(s.reason));
      if(p.status==="fulfilled")setPage(p.value);else if(s.status==="fulfilled")setNotice(gmailError(p.reason));
      operation.current="";setBusy("");
    });
    return()=>{epoch.current++;if(operation.current==="connect")void invoke({kind:"cancel",accountId:id}).catch(()=>{})};
  },[id,invoke,setLabel]);
  async function run<T>(
    kind: string,
    task: (isCurrent: () => boolean) => Promise<T>,
    apply: (result: T) => void,
    origin?: HTMLButtonElement,
  ) {
    if (operation.current) return false;
    if (origin && origin.ownerDocument.activeElement === origin) {
      operationFocus.current = { origin, kind };
    }
    const gen = ++epoch.current;
    operation.current = kind;
    setBusy(kind);
    setNotice("");
    try {
      const value = await task(() => epoch.current === gen);
      if (epoch.current !== gen) return false;
      apply(value);
      return true;
    } catch (error) {
      if (epoch.current === gen && kind !== "cachedLabels") {
        setNotice(gmailError(error));
        if (kind === "reply") setReplyRefresh(gmailReplyNeedsRefresh(error));
        if (String(error).includes("gmail_reauthorize")) saveGrant(none);
      }
      return false;
    }
    finally {if(epoch.current===gen){operation.current="";setBusy("")}}
  }
  function connect(send: boolean, origin: HTMLButtonElement) {
    void run("connect", () => invoke<Grant>({ kind: "connect", send, accountId: id }), g => {
      saveGrant(g,g.connected);
      if (send && !g.send) setNotice(t("Google did not grant sending permission."));
    }, origin);
  }
  async function cancel() {
    const kind = operation.current;
    if (kind !== "connect" && kind !== "refresh") return;
    const gen = ++epoch.current;
    operation.current = "cancel";
    setBusy("cancel");
    try {
      await invoke({ kind: "cancel", accountId: id });
      const fresh = kind === "connect" ? await invoke<Grant>({ kind: "status", accountId: id }) : null;
      if (epoch.current === gen) {
        if (fresh) saveGrant(fresh);
        setNotice(t(kind === "connect" ? "Sign-in canceled." : "Gmail refresh canceled."));
      }
    } catch (error) {
      if (epoch.current === gen) setNotice(gmailError(error));
    } finally {
      if (epoch.current === gen) {
        operation.current = "";
        setBusy("");
      }
    }
  }
  function load(
    server: boolean,
    cursor: string | null = null,
    selected = label,
    append = false,
    origin?: HTMLButtonElement,
  ) {
    const resumeFromCache = append && serverPage && !server;
    const readPage = (position: string | null) => invoke<Page | null>({
      kind: server ? "list" : "cachedPage", accountId: id, label: selected, cursor: position, limit: 20,
    });
    void run(server ? "refresh" : "list", async isCurrent => {
      let result = await readPage(resumeFromCache ? null : cursor).catch((error: unknown) => {
        if (isCurrent() && server && cursor && String(error).replace(/^Error:\s*/, "") === "gmail_page_expired") {
          setExpiredCursor(cursor);
        }
        throw error;
      });
      if (!resumeFromCache) return result;
      // Server tokens cannot advance a cached label. Skip local pages already on screen.
      const visible = new Set(page?.items.map(item => item.id));
      const visited = new Set<string>();
      while (isCurrent() && result?.nextCursor && result.items.length && result.items.every(item => visible.has(item.id))) {
        const next = result.nextCursor;
        if (visited.has(next)) return { ...result, nextCursor: null };
        visited.add(next);
        result = await readPage(next);
      }
      return result;
    }, p => {
      if (!append) {
        setExpiredCursor(null);
        if (selected !== label) setLabel(selected);
        setPage(p);
        const retained = selected === label
          ? p?.items.find(item => item.id === message?.id)
          : undefined;
        setMessage(retained ?? null);
        if (!retained) setBody(null);
      }
      else if (p) {
        setPage(old => {
          const items = old?.items ?? [];
          const visible = new Set(items.map(item => item.id));
          return { ...p, items: [...items, ...p.items.filter(item => !visible.has(item.id))] };
        });
      } else {
        setPage(old => old && { ...old, nextCursor: null });
        setNotice(t("No older cached page is available."));
      }
      if(server)window.dispatchEvent(new CustomEvent("studio-mail-cache-updated",{detail:id}));
      setServerPage(server);
    }, server ? origin : undefined);
  }
  function retryCachedLabels() {
    void run("cachedLabels", () => invoke<Label[] | null>({ kind: "cachedLabels", accountId: id }), items => {
      setLabels(items ?? []);
      setCachedLabelsFailed(false);
    });
  }
  function refreshLabels() {
    void run("labels", async isCurrent => {
      const items = await invoke<Label[]>({ kind: "labels", accountId: id });
      if (!isCurrent()) return;
      setLabels(items);
      setCachedLabelsFailed(false);
      window.dispatchEvent(new CustomEvent("studio-mail-directory-updated", { detail: id }));
      if (label === "INBOX" || items.some(item => item.id === label)) return;
      setLabel("INBOX");
      setPage(null);
      setMessage(null);
      setBody(null);
      setReplyRefresh(false);
      setServerPage(false);
      const inbox = await invoke<Page | null>({ kind: "cachedPage", accountId: id, label: "INBOX", cursor: null, limit: 20 });
      if (isCurrent()) setPage(inbox);
    }, () => {});
  }
  function select(m: Message, mode: "open" | "cache" | "download" = "open") {
    if (operation.current) return;
    setMessage(m);setBody(null);setReplyRefresh(false);setLocalBodyFailed(false);
    const message = { accountId: id, id: m.id };
    void run("read", async isCurrent => {
      if (mode !== "download") {
        let cached: Body | null;
        try { cached = await invoke<Body | null>({ kind: "cachedBody", ...message }); }
        catch {
          if (isCurrent()) setLocalBodyFailed(true);
          return null;
        }
        if (cached || mode === "cache" || !readFromServer || !isCurrent()) return cached;
      }
      return invoke<Body>({ kind: "read", ...message });
    }, setBody);
  }
  const disconnected=!grant.connected;
  const connectionStatus = grant.needsReconnect ? "Reconnect Gmail with the permission needed for this action."
    : disconnected ? "Gmail is not connected. Local drafts are still available."
    : grant.send ? "Gmail is connected for reading and sending." : "Gmail is connected for reading.";
  const readFromServer = serverPage && !disconnected && grant.read === true;
  const needsLabelRefresh = readFromServer && expiredCursor !== null && page?.nextCursor === expiredCursor;
  return <section aria-label={t("Gmail inbox")}>
    <fieldset disabled={Boolean(busy)}><legend>{t("Mail connection")}</legend>
      <p translate="no">{address}</p>
      <p>{t(connectionStatus)}</p>
      {disconnected&&<button className="ui-button" type="button" ref={primaryAuthorization} onClick={event => connect(false, event.currentTarget)}>{t("Sign in to read Gmail")}</button>}
      {!disconnected&&<button className="ui-button" type="button" ref={primaryAuthorization} onClick={event => connect(grant.send === true, event.currentTarget)}>{t("Reconnect Gmail")}</button>}
      {!disconnected&&!grant.send&&<button className="ui-button" type="button" onClick={event => connect(true, event.currentTarget)}>{t("Authorize sending with Gmail")}</button>}
      <MailDisconnect connected={!disconnected} label={t("Disconnect Gmail")} prompt={t("Disconnect Gmail on this device? Saved drafts will remain.")}
        disconnect={clear=>run("disconnect",()=>invoke<{revoked:boolean}>({kind:"disconnect",accountId:id,clearCache:clear}),r=>{
          saveGrant(none);
          if(clear){setServerPage(false);setLabel("INBOX");setLabels([]);setCachedLabelsFailed(false);setPage(null);setMessage(null);setBody(null);window.dispatchEvent(new CustomEvent("studio-mail-cache-cleared",{detail:id}))}
          setNotice(t(r.revoked?"Gmail disconnected.":"Disconnected on this device. Review Google account permissions to confirm revocation."))
        })}/>
    </fieldset>
    {busy==="connect"&&<div role="status"><p>{t("Complete authorization in your browser. No email will be sent.")}</p><button className="ui-button" type="button" ref={cancelOperation} onClick={()=>void cancel()}>{t("Cancel sign-in")}</button></div>}
    {busy === "refresh" && <div role="status">
      <button className="ui-button" type="button" ref={cancelOperation} onClick={() => void cancel()}>{t("Cancel Gmail refresh")}</button>
    </div>}
    <fieldset disabled={Boolean(busy)}><legend>{t("Inbox")}</legend>
      <label>{t("Gmail label")} <select className="ui-select" value={label} onChange={e=>load(false,null,e.target.value)}>
        <option value="INBOX">{t("Inbox")}</option>
        {labels.filter(item=>item.id!=="INBOX").map(item=><option key={item.id} value={item.id} translate="no">{item.name}</option>)}
      </select></label>
      <button className="ui-button" type="button" disabled={!grant.read} onClick={refreshLabels}>{t("Refresh Gmail labels")}</button>
      {cachedLabelsFailed && <>
        <p role="status">{t("Could not read saved Gmail labels.")}</p>
        <button className="ui-button" type="button" onClick={retryCachedLabels}>{t("Retry saved Gmail labels")}</button>
      </>}
      <button className="ui-button" type="button" onClick={()=>load(false)}>{t(label==="INBOX"?"Show offline inbox":"Show saved messages")}</button>
      <button className="ui-button" type="button" ref={refreshButton} disabled={!grant.read} onClick={event => load(true, null, label, false, event.currentTarget)}>{t("Refresh from server")}</button>
      {page?<><p>{t(readFromServer?"Showing messages retrieved from the server.":"Showing messages saved on this device.")}</p>
        {!page.items.length&&<p>{t("No messages on this page.")}</p>}
        <ul className="mail-inbox-list">{page.items.map(m=><li key={m.id}><button className="ui-button" type="button" aria-pressed={message?.id===m.id} onClick={()=>select(m)}><strong translate="no">{m.subject||t("No subject")}</strong><small translate="no">{m.from}</small></button></li>)}</ul>
        {page.nextCursor && <button className="ui-button" type="button" onClick={event => {
          if (needsLabelRefresh) load(true, null, label, false, event.currentTarget);
          else load(readFromServer, page.nextCursor, label, true, event.currentTarget);
        }}>{t(needsLabelRefresh ? "Refresh this Gmail label" : "Load older messages")}</button>}
      </>:<p>{t("No inbox has been saved on this device yet.")}</p>}
      {message&&<article aria-label={t("Selected message")}><h3 translate="no">{message.subject||t("No subject")}</h3><p translate="no">{message.from}</p>
        {body?<><MailBody text={body.plainText} html={body.html}/><MailAttachments key={message.id} items={body.attachments} invoke={invoke} message={{accountId:id,id:message.id}} canDownload={!disconnected && grant.read === true}/></>:localBodyFailed ? <>
          <p role="alert">{t("Could not access local mail data.")}</p>
          <button className="ui-button" type="button" onClick={()=>select(message,"cache")}>{t("Try again")}</button>
        </>:!busy&&<p>{t("This message is not available offline. Download it explicitly to read it.")}</p>}
        {!body&&!replyRefresh&&!localBodyFailed&&<button className="ui-button" type="button" disabled={!grant.read} onClick={()=>select(message,"download")}>{t("Download message body")}</button>}
        {onReply&&<button className="ui-button" type="button" disabled={draftBusy} onClick={()=>{
          setReplyRefresh(false);
          void run("reply",active=>onReply(id,()=>invoke<Draft>({kind:"replyDraft",accountId:id,id:message.id}),active),()=>{});
        }}>{t("Create reply draft")}</button>}
        {replyRefresh&&<button className="ui-button" type="button" disabled={!grant.read} onClick={() => {
          void run("read", () => invoke<Body>({kind:"read",accountId:id,id:message.id}), refreshed => {
            setBody(refreshed);
            setLocalBodyFailed(false);
            setReplyRefresh(false);
          });
        }}>{t("Refresh message to reply")}</button>}
      </article>}
    </fieldset>
    {notice&&<p role="status">{notice}</p>}
  </section>
}
