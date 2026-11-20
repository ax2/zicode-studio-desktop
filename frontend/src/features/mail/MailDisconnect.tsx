import { useState } from "react";
import { t } from "../../shared/i18n";

export function MailDisconnect({ connected, label, prompt, disconnect }: {
  connected: boolean; label: string; prompt: string; disconnect: (clearCache: boolean) => Promise<void>;
}) {
  const [clear, setClear] = useState(false);
  async function confirmChoice() {
    const accepted = await window.confirm(clear
      ? t("Clear cached messages for this account? Drafts and delivery records will be kept.")
      : prompt);
    if (accepted) { setClear(false); await disconnect(clear); }
  }
  return <>
    <label><input type="checkbox" checked={clear} onChange={e=>setClear(e.target.checked)}/>
      {t("Clear cached messages for this account")}</label>
    {(connected || clear) && <button type="button" onClick={()=>void confirmChoice()}>
      {connected ? label : t("Clear offline messages")}</button>}
  </>;
}
