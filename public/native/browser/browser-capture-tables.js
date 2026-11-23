import { t } from "../../i18n.js";

export function renderBrowserCaptureTables(tables) {
  const scroll = document.createElement("div"); scroll.className = "browser-capture-tables-scroll";
  scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", t("Page tables"));
  for (const { caption, rows, firstRowHeader } of tables) {
    const table = document.createElement("table");
    if (caption) table.createCaption().textContent = caption;
    const body = table.createTBody();
    rows.forEach((row, index) => {
      const header = index === 0 && firstRowHeader;
      const tr = header ? table.createTHead().insertRow() : body.insertRow();
      for (const value of row) {
        const cell = document.createElement(header ? "th" : "td");
        if (header) cell.scope = "col";
        cell.textContent = value; tr.append(cell);
      }
    });
    scroll.append(table);
  }
  return scroll;
}
