import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";

export function MailDisconnect({ connected, label, prompt, disconnect }: {
  connected: boolean; label: string; prompt: string; disconnect: (clearCache: boolean) => Promise<void>;
}) {
  const [clear, setClear] = useState(false);
  const live = useRef(true);
  const pending = useRef(false);
  useEffect(()=>{ live.current=true; return ()=>{live.current=false}; },[]);
  async function confirmChoice() {
    if(pending.current) return;
    pending.current=true;
    try {
    const accepted = await window.confirm(clear
      ? (connected ? t("Disconnect this account and clear its cached messages? Drafts and delivery records will be kept.") : t("Clear cached messages for this account? Drafts and delivery records will be kept."))
      : prompt);
    if (accepted && live.current) { setClear(false); await disconnect(clear); }
    } finally { pending.current=false; }
  }
  return <>
    <label><input type="checkbox" checked={clear} onChange={e=>setClear(e.target.checked)}/>
      {t("Clear cached messages for this account")}</label>
    {(connected || clear) && <button className="ui-button" type="button" onClick={()=>void confirmChoice()}>
      {connected ? label : t("Clear offline messages")}</button>}
  </>;
}
