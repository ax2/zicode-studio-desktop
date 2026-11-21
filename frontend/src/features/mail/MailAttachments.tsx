import { useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { Invoke } from "./index";

export type Attachment = { id: number; name: string; size: number };
type MessageRef = {accountId: string; id: string} | {accountId: string; folder?:string; uidValidity: number; uid: number};

export function MailAttachments({ items, invoke, message }: { items?: Attachment[]; invoke?: Invoke; message: MessageRef }) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  if (!invoke || !items?.length) return null;
  async function save(part: number) {
    if (lock.current || !invoke) return;
    lock.current = true;
    setBusy(true);
    setStatus("");
    try {
      const result = await invoke<{ saved: boolean }>({kind:"downloadAttachment", ...message, part});
      setStatus(t(result.saved ? "Attachment saved." : "Download canceled."));
    } catch (error) {
      const reason = String(error);
      setStatus(t(reason.includes("mail_attachment_exists") ? "A file with that name already exists. Choose another name." :
        /credentials_disabled|password_missing|reauthorize/.test(reason) ? "Connect this mail account to download attachments." : "Could not download the attachment."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return <section aria-label={t("Attachments")}><h4>{t("Attachments")}</h4><ul>
    {items.map(item=><li key={item.id}><span translate="no">{item.name} · {item.size.toLocaleString()} B</span>{"uid" in message && <> ({t("transfer size")})</>}{" "}
      <button type="button" disabled={busy} aria-label={t("Download attachment")+" "+item.name} onClick={()=>void save(item.id)}>{t("Download attachment")}</button></li>)}
  </ul>{status && <p role="status">{status}</p>}</section>;
}
