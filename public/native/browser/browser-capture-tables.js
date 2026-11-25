import { t } from "../../i18n.js";
import { appendPartialCapture } from "./browser-capture-status.js";

export function selectCapturedTables(tables = [], tableIndexes) {
  return tableIndexes ? tables.filter((_, index) => tableIndexes.includes(index)) : tables;
}

function appendTableText(element, value) {
  const [first, ...lines] = value.split("\n");
  element.append(first);
  for (const line of lines) element.append(document.createElement("br"), line);
}

export function renderBrowserCaptureTables(tables, controls = []) {
  const scroll = document.createElement("div"); scroll.className = "browser-capture-tables-scroll";
  scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", t("Page tables"));
  for (const [index, { caption, rows, firstRowHeader }] of tables.entries()) {
    if (controls[index]) scroll.append(controls[index]);
    const table = document.createElement("table");
    table.setAttribute("translate", "no");
    if (caption) appendTableText(table.createCaption(), caption);
    const body = table.createTBody();
    rows.forEach((row, index) => {
      const header = index === 0 && firstRowHeader;
      const tr = header ? table.createTHead().insertRow() : body.insertRow();
      for (const value of row) {
        const cell = document.createElement(header ? "th" : "td");
        if (header) cell.scope = "col";
        appendTableText(cell, value); tr.append(cell);
      }
    });
    scroll.append(table);
  }
  return scroll;
}

export function createBrowserCaptureTables(page) {
  const tables = page.tables ?? [];
  const all = document.createElement("input"); all.type = "checkbox";
  const multiple = tables.length > 1;
  const choices = tables.map(() => multiple ? document.createElement("input") : all);
  const selectedIndexes = () => choices.flatMap((choice, index) => choice.checked ? [index] : []);
  function updateAll() {
    const count = selectedIndexes().length;
    all.checked = count === tables.length;
    all.indeterminate = count > 0 && !all.checked;
  }
  function attachments() {
    const tableIndexes = selectedIndexes();
    return {
      includeTables: tableIndexes.length > 0,
      ...(tableIndexes.length > 0 && tableIndexes.length < tables.length ? { tableIndexes } : {}),
    };
  }
  if (!tables.length && !page.tablesTruncated) return { attachments };

  const element = document.createElement("details"); element.className = "browser-capture-tables";
  const summary = document.createElement("summary");
  summary.textContent = `${t("Page tables")} (${tables.length})`;
  if (page.tablesTruncated) appendPartialCapture(summary);
  element.append(summary);
  if (tables.length) {
    const share = document.createElement("label");
    share.append(all, t(multiple ? "Include all structured tables" : "Include tables in the page note or chat draft"));
    element.append(share);
    const help = document.createElement("p");
    help.textContent = t("Table selections attach structured data. Page text can still contain words from tables.");
    element.append(help);

    all.addEventListener("change", () => {
      for (const choice of choices) choice.checked = all.checked;
      updateAll();
    });
    const labels = multiple ? choices.map((choice, index) => {
      const { caption } = tables[index];
      const name = t("Include table {number}").replace("{number}", String(index + 1));
      choice.type = "checkbox";
      choice.setAttribute("aria-label", caption ? `${name} · ${caption}` : name);
      choice.addEventListener("change", updateAll);
      const label = document.createElement("label");
      label.append(choice, name);
      return label;
    }) : [];
    element.append(renderBrowserCaptureTables(tables, labels));
  }
  if (page.tablesTruncated) {
    const limit = document.createElement("p");
    limit.textContent = t("Only some table data is shown.");
    element.append(limit);
  }
  return { attachments, element };
}
