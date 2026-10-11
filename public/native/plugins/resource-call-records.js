import { t } from "../../i18n.js";
import { normalizeResourceReconciliation } from "./resource-call-admission.js";
import { resourceCallRecoveryMessage } from "./resource-call-recovery-message.js";

export function createResourceCallRecords({ container, gateway, getTarget, scope, confirm = message => globalThis.confirm(message) }) {
  let active = true, open = false, busy = false, sequence = 0;
  const key = target => JSON.stringify([target?.sceneId ?? "programming", target?.workspaceId]);
  const valid = () => active && key(scope) === key(getTarget?.());
  const node = (tag, text, className) => {
    const result = document.createElement(tag); if (text) result.textContent = text;
    if (className) result.className = className; return result;
  };
  const button = (text, action) => {
    const result = node("button", t(text), "ui-button ui-button--secondary"); result.type = "button";
    result.addEventListener("click", action); return result;
  };
  const toggle = button("Review tool call records", () => {
    if (!valid()) return; open = !open; sequence++; busy = false;
    body.hidden = !open; toggle.setAttribute("aria-expanded", String(open));
    list.replaceChildren(); status.textContent = ""; if (open) void load();
  });
  toggle.setAttribute("aria-expanded", "false");
  const body = node("div"), status = node("p"), list = node("div"); status.setAttribute("role", "status"); body.hidden = true;
  body.append(node("p", t("Call metadata stays in this desktop or browser profile, without inputs or results. Recovery seals unstarted calls or requests cancellation. A different Host cannot confirm old work.")),
    button("Refresh call records", () => { if (!busy) void load(); }), status, list);
  container.classList.add("resource-call-records", "ui-panel"); container.append(toggle, body);
  function controls(disabled) { for (const item of body.querySelectorAll("button")) item.disabled = disabled; }
  async function load() {
    if (!valid() || !open) return;
    const token = ++sequence; busy = true; controls(true); list.replaceChildren(); status.textContent = t("Loading…");
    try {
      const records = await gateway.resourceCalls.list(scope);
      if (!valid() || token !== sequence) return;
      status.textContent = records.length ? t("Stored calls are not proof of completion or saved results.") : t("No stored tool calls in this project.");
      for (const record of records) {
        const card = node("article", "", "ui-card"), actions = node("div", "", "ui-toolbar");
        actions.append(button("Stop and recover call", () => void recover(record, card)),
          button("Forget call record", () => void forget(record, card)));
        card.append(node("strong", record.label),
          node("p", new Date(record.createdAt).toLocaleString()), actions); list.append(card);
      }
    } catch { if (valid() && token === sequence) status.textContent = t("Call records are unavailable. Existing records were kept."); }
    finally { if (valid() && token === sequence) { busy = false; controls(false); } }
  }
  async function recover(record, card) {
    if (!valid() || busy) return;
    const token = ++sequence; busy = true; controls(true); status.textContent = t("Sealing or cancelling the call…");
    try {
      const response = await gateway.reconcileResourceCall(record.owner, record.ticket);
      const proof = normalizeResourceReconciliation(response, record.owner, record.ticket);
      if (!valid() || token !== sequence) return;
      if (proof.executionFinished) {
        await gateway.resourceCalls.remove(record);
        if (!valid() || token !== sequence) return; card.remove();
      }
      status.textContent = t(resourceCallRecoveryMessage(proof));
    } catch (error) { if (valid() && token === sequence) status.textContent = t(resourceCallRecoveryMessage(null,
      error?.code === "resource_call_host_changed" ? new Error("[resource_call_host_changed]") : error)); }
    finally { if (valid() && token === sequence) { busy = false; controls(false); } }
  }
  async function forget(record, card) {
    if (!valid() || busy || !confirm(t("Forget this local record? This does not cancel or confirm execution. Check the original runtime before running again.")) || !valid()) return;
    const token = ++sequence; busy = true; controls(true);
    try {
      await gateway.resourceCalls.remove(record);
      if (valid() && token === sequence) { card.remove(); status.textContent = t("Local record forgotten. No execution was cancelled or confirmed."); }
    } catch { if (valid() && token === sequence) status.textContent = t("Call records are unavailable. Existing records were kept."); }
    finally { if (valid() && token === sequence) { busy = false; controls(false); } }
  }
  return { destroy() { active = false; sequence++; container.replaceChildren(); } };
}
