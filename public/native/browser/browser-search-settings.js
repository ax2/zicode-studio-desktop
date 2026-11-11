import { t } from "../../i18n.js";
import { searchProviders } from "./browser-address.js";

export function createBrowserSearchSettings({ save, report }) {
  const element = document.createElement("label"); element.textContent = t("Search engine");
  const select = document.createElement("select"); select.className = "ui-select browser-search-engine";
  select.setAttribute("aria-label", t("Search engine")); select.disabled = true;
  for (const [id, name] of searchProviders) {
    const option = document.createElement("option"); option.value = id; option.textContent = name === "Baidu" ? t("Baidu") : name; select.append(option);
  }
  let current = "bing";
  select.addEventListener("change", async () => {
    select.disabled = true;
    try { const saved = await save(select.value); if (!searchProviders.some(([id]) => id === saved)) throw new Error("Invalid provider response"); current = saved; }
    catch { report(t("Search engine could not be saved. Your previous choice was kept.")); }
    finally { select.value = current; select.disabled = false; }
  });
  element.append(select);
  return { element, value: () => current, initialize(value = "bing") { current = searchProviders.some(([id]) => id === value) ? value : "bing"; select.value = current; select.disabled = false; } };
}
