(() => {
  const excluded = 'script,style,noscript,template,input,textarea,select,option,[contenteditable], [hidden], [aria-hidden="true"]';
  const allowed = node => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || element.closest(excluded)) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const visible = element => allowed(element) &&
    element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
  const shortText = (value, max) => [...value.trim().slice(0, max * 2)].slice(0, max).join("");
  const webUrl = value => {
    if (!value || value.length > 1024 || !/^https?:\/\//.test(value)) return null;
    try {
      const url = new URL(value);
      return url.username || url.password ? null : url.href;
    } catch { return null; }
  };
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let text = '', visited = 0, truncated = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++visited > 12000) { truncated = true; break; }
    if (!allowed(node)) continue;
    const part = (node.nodeValue || '').trim();
    if (!part) continue;
    const remaining = 48000 - text.length;
    if (part.length + 1 > remaining) { text += part.slice(0, Math.max(0, remaining)); truncated = true; break; }
    text += part + '\n';
  }
  const selection = getSelection();
  // A selection intersecting an editable/form region is not shared.
  let selected = '';
  if (selection?.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    const safe = allowed(range.startContainer) && allowed(range.endContainer) &&
      ![...document.querySelectorAll('input,textarea,select,[contenteditable]')].some(element => range.intersectsNode(element));
    if (safe) selected = selection.toString().slice(0, 8192);
  }
  const links = [];
  const seen = new Set();
  const anchors = document.links;
  let linksTruncated = anchors.length > 1000;
  for (let i = 0; i < Math.min(anchors.length, 1000); i++) {
    const anchor = anchors[i];
    if (anchor.localName !== "a" || !visible(anchor) ||
        anchor.querySelector('input,textarea,select,[contenteditable]')) continue;
    const url = webUrl(anchor.href);
    if (!url || seen.has(url)) continue;
    if (links.length === 20) { linksTruncated = true; break; }
    seen.add(url);
    const label = shortText(anchor.innerText, 120);
    links.push({ label, url });
  }
  const tables = [];
  let tablesTruncated = false;
  let tableTextRemaining = 3600;
  const readTableText = (element, table) => {
    const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const limit = Math.min(120, tableTextRemaining);
    let value = "", scanned = 0;
    for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
      if (++scanned > 64) { tablesTruncated = true; break; }
      const parent = node.parentElement;
      if (!parent || parent.closest("table") !== table || !visible(parent)) continue;
      const part = node.nodeValue.trim();
      if (!part) continue;
      const available = limit - [...value].length;
      const chars = [...part.slice(0, available * 2 + 2)];
      if (value && available) value += " ";
      const remaining = limit - [...value].length;
      value += chars.slice(0, remaining).join("");
      if (chars.length > remaining) { tablesTruncated = true; break; }
    }
    tableTextRemaining -= [...value].length;
    return value.trim();
  };
  const pageTables = document.getElementsByTagName("table");
  tablesTruncated = pageTables.length > 100;
  for (let index = 0; index < Math.min(pageTables.length, 100); index++) {
    const table = pageTables[index];
    if (table.parentElement?.closest("table") || !visible(table)) continue;
    if (tables.length === 4) { tablesTruncated = true; break; }
    const rows = [];
    if (table.rows.length > 80) tablesTruncated = true;
    for (let i = 0; i < Math.min(table.rows.length, 80); i++) {
      if (!visible(table.rows[i])) continue;
      if (rows.length === 16) { tablesTruncated = true; break; }
      rows.push(table.rows[i]);
    }
    if (!rows.length) continue;
    const caption = table.caption && visible(table.caption) ? readTableText(table.caption, table) : "";
    const grid = rows.map(() => Array(8).fill(null));
    let columns = 0, firstRowHeader = true;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      let groupEnd = r + 1;
      while (groupEnd < rows.length && rows[groupEnd].parentElement === row.parentElement) groupEnd++;
      let column = 0;
      if (row.cells.length > 32) tablesTruncated = true;
      for (let i = 0; i < Math.min(row.cells.length, 32); i++) {
        const cell = row.cells[i];
        if (!cell.getClientRects().length) continue;
        if (r === 0 && cell.localName !== "th") firstRowHeader = false;
        while (column < 8 && grid[r][column] !== null) column++;
        if (column === 8) { tablesTruncated = true; break; }
        const right = Math.min(8, column + cell.colSpan);
        if (right < column + cell.colSpan) tablesTruncated = true;
        const bottom = cell.rowSpan === 0 ? groupEnd : Math.min(groupEnd, r + cell.rowSpan);
        // Reserve covered slots so subsequent cells stay in their source column.
        for (let y = r; y < bottom; y++) {
          for (let x = column; x < right; x++) grid[y][x] ??= "";
        }
        grid[r][column] = visible(cell) ? readTableText(cell, table) : "";
        columns = Math.max(columns, right);
        column = right;
      }
    }
    if (columns) tables.push({ caption, firstRowHeader, rows: grid.map(row => row.slice(0, columns).map(cell => cell ?? "")) });
  }
  const metadata = {
    language: shortText(document.documentElement.lang || "", 64),
    description: shortText(document.head?.querySelector('meta[name="description" i]')?.content || "", 400),
    canonicalUrl: webUrl(document.head?.querySelector('link[rel~="canonical" i]')?.href),
  };
  const images = [];
  const imageKeys = new Set();
  const pageImages = document.images;
  let imagesTruncated = pageImages.length > 400;
  for (let i = 0; i < Math.min(pageImages.length, 400); i++) {
    const img = pageImages[i];
    const { naturalWidth: width, naturalHeight: height } = img;
    if (!width || !height || width > 100000 || height > 100000 || !visible(img)) continue;
    const alt = shortText(img.alt, 160);
    // currentSrc describes the candidate already selected by the page, including srcset.
    const url = webUrl(img.currentSrc);
    const key = url ? JSON.stringify([url, alt, width, height]) : null;
    if (key && imageKeys.has(key)) continue;
    if (images.length === 12) { imagesTruncated = true; break; }
    if (key) imageKeys.add(key);
    images.push({ alt, width, height, url });
  }
  return { title: document.title.slice(0, 512), url: location.href, text, selection: selected, truncated,
    links, linksTruncated, tables, tablesTruncated, metadata, images, imagesTruncated };
})()
