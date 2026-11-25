const search = "M14 9a5 5 0 1 1-10 0 5 5 0 0 1 10 0 M13 13l7 7";
const restore = "M3 9V4m0 5h5 M4 9a8 8 0 1 1 1 9";
const paths = {
  "New browser window": "M3 5h18v14H3z M3 9h18 M12 11v6 M9 14h6",
  "Browser profiles": "M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 20a7 7 0 0 1 14 0",
  "New private window": "M3 12h18 M6 11l2-7 4 2 4-2 2 7 M10 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M10 16h4",
  "Reopen closed window": restore,
  "Reopen closed tab": restore,
  "Search tabs": search,
  "Find in page": search,
  "Bookmarks": "m12 3 3 6 6 1-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L3 10l6-1z",
  "Add website shortcut": "M4 4h16v16H4z M4 8h16 M12 10v7 M8.5 13.5h7",
  "Downloads": "M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5",
  "Browsing history": "M3 11a9 9 0 1 1 2 7 M3 5v6h6 M12 7v5l3 2",
  "Site permissions and storage": "M12 3l8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z",
  "Reading mode": "M3 5q5-2 9 1 4-3 9-1v14q-5-2-9 1-4-3-9-1z M12 6v14",
  "Translate selected text": "M3 6h12 M9 3v3 M5 8q2 6 8 9 M13 7q-2 6-9 10 M14 21l4-10 4 10 M16 17h4",
  "Save viewport PNG to Downloads": "M3 7h4l2-3h6l2 3h4v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  "Open local PDF…": "M3 20V6h7l2 2h9v12z M10 13h7 M10 16h5",
  "Print page…": "M7 8V3h10v5 M7 17H3V9h18v8h-4 M7 14h10v7H7z",
  "Save page PDF to Downloads": "M5 3h9l5 5v13H5z M14 3v6h5 M8 15h8",
  "Developer tools": "M3 4h18v16H3z M8 8l-3 3 3 3 M16 8l3 3-3 3 M13 7l-2 9",
  "Select all page text": "M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 10h8 M8 14h6",
  "Enter fullscreen": "M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6",
  "Pin tab": "M8 3h8l-1 6 3 4H6l3-4z M12 13v8",
};

export function decorateBrowserCommands(panel) {
  for (const button of panel.querySelectorAll(".browser-menu-group > button")) {
    const name = button.classList.contains("browser-pin-tab") ? "Pin tab" : button.dataset.i18nText || (button.classList.contains("browser-fullscreen-toggle") && "Enter fullscreen");
    const path = paths[name];
    if (!path) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
    button.style.setProperty("--browser-command-icon", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    button.classList.add("browser-menu-command");
    const keys = button.getAttribute("aria-keyshortcuts");
    if (keys) button.dataset.shortcut = keys.replace("Control", "Ctrl").replace(/[a-z]$/, letter => letter.toUpperCase());
  }
}
