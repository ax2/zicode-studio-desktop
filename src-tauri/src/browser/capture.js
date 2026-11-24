(() => {
  const excluded = 'script,style,noscript,template,input,textarea,select,option,[contenteditable], [hidden], [inert], [aria-hidden="true"]';
  const allowed = node => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || element.closest(excluded)) return false;
    const style = element.ownerDocument?.defaultView?.getComputedStyle(element) ?? getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      element.getClientRects().length > 0 &&
      element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
  };
  const visible = allowed;
  // Preserve the UTF-16 budget without passing half an emoji to the Rust JSON decoder.
  const clip = (value, limit) => {
    if (limit <= 0) return '';
    if (value.length <= limit) return value;
    const last = value.charCodeAt(limit - 1);
    return value.slice(0, last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit);
  };
  const shortText = (value, max) => [...value.trim().slice(0, max * 2)].slice(0, max).join("");
  const webUrl = value => {
    if (!value || value.length > 1024 || !/^https?:\/\//.test(value)) return null;
    try {
      const url = new URL(value);
      return url.username || url.password ? null : url.href;
    } catch { return null; }
  };
  let textRemaining = 48000;
  let nodesRemaining = 12000;
  let selectionRemaining = 8192;
  function readText(doc, limit) {
    const charLimit = Math.min(limit, textRemaining);
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
    let text = '', textTruncated = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (nodesRemaining === 0) { textTruncated = true; break; }
      nodesRemaining--;
      if (!allowed(node)) continue;
      const part = (node.nodeValue || '').trim();
      if (!part) continue;
      const remaining = charLimit - text.length;
      if (part.length > remaining) { text += clip(part, remaining); textTruncated = true; break; }
      text += part;
      if (part.length < remaining) text += '\n';
    }
    textRemaining -= text.length;
    return { text, textTruncated };
  }
  function readSelection(doc, selection) {
    const empty = { selection: '', selectionTruncated: false };
    const editable = 'form,input,textarea,select,button,[contenteditable]';
    // Focus in an editable region or child frame can leave an unrelated selection in this document.
    if (selection?.rangeCount !== 1 || selection.isCollapsed ||
        doc.activeElement?.closest(editable + ',iframe,frame')) return empty;
    const range = selection.getRangeAt(0);
    if (!allowed(range.startContainer) || !allowed(range.endContainer)) return empty;
    const controls = doc.querySelectorAll(editable);
    if (controls.length > 256 || Array.from(controls).some(element => range.intersectsNode(element))) return empty;
    const value = selection.toString();
    const selected = clip(value, selectionRemaining);
    selectionRemaining -= selected.length;
    return { selection: selected, selectionTruncated: selected.length < value.length };
  }
  const mainText = readText(document, textRemaining);
  const mainSelection = readSelection(document, getSelection());
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
  let tablesRemaining = 4;
  let tablesToScan = 100;
  let tableTextRemaining = 3600;
  function readTables(doc) {
    const tables = [];
    let tablesTruncated = false;
    const readTableText = (element, table) => {
      const nodes = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
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
    const pageTables = doc.getElementsByTagName("table");
    const scan = Math.min(pageTables.length, tablesToScan);
    tablesToScan -= scan;
    tablesTruncated = pageTables.length > scan;
    for (let index = 0; index < scan; index++) {
      const table = pageTables[index];
      if (table.parentElement?.closest("table") || !visible(table)) continue;
      if (tablesRemaining === 0) { tablesTruncated = true; break; }
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
      if (columns) {
        tablesRemaining--;
        tables.push({ caption, firstRowHeader, rows: grid.map(row => row.slice(0, columns).map(cell => cell ?? "")) });
      }
    }
    return { tables, tablesTruncated };
  }
  function readImages(doc, allowance, scanLimit) {
    const images = [];
    const imageKeys = new Set();
    const pageImages = doc.images ?? [];
    let imagesTruncated = pageImages.length > scanLimit;
    for (let i = 0; i < Math.min(pageImages.length, scanLimit); i++) {
      const img = pageImages[i];
      const { naturalWidth: width, naturalHeight: height } = img;
      if (!width || !height || width > 100000 || height > 100000 || !visible(img)) continue;
      const alt = shortText(img.alt, 160);
      // currentSrc describes the candidate already selected by the page, including srcset.
      const url = webUrl(img.currentSrc);
      const key = url ? JSON.stringify([url, alt, width, height]) : null;
      if (key && imageKeys.has(key)) continue;
      if (images.length === allowance) { imagesTruncated = true; break; }
      if (key) imageKeys.add(key);
      images.push({ alt, width, height, url });
    }
    return { images, imagesTruncated };
  }
  const mainImages = readImages(document, 12, 400);
  const mainTables = readTables(document);
  const frames = [];
  let framesOmitted = false;
  let framesToScan = 24;
  const origin = location.origin;
  let frameImagesRemaining = 12;
  let frameImagesToScan = 400;
  function readFrames(doc, path) {
    const children = doc.querySelectorAll('iframe,frame');
    if (path.length === 3) {
      framesOmitted ||= children.length > 0;
      return;
    }
    for (let index = 0; index < children.length; index++) {
      const element = children[index];
      if (framesToScan === 0 || frames.length === 6) { framesOmitted = true; return; }
      framesToScan--;
      if (!visible(element)) continue;
      if (element.hasAttribute('sandbox')) { framesOmitted = true; continue; }
      // contentDocument exposes only a document the browser considers same-origin.
      const child = element.contentDocument;
      if (!child?.body) { framesOmitted = true; continue; }
      const address = child.URL;
      const url = webUrl(address);
      const inline = address === 'about:srcdoc' || address === 'about:blank';
      if (!inline && (!url || new URL(url).origin !== origin)) { framesOmitted = true; continue; }
      const body = readText(child, 8000);
      const selection = readSelection(child, child.getSelection());
      const tables = readTables(child);
      const imageScan = Math.min(child.images?.length ?? 0, frameImagesToScan);
      frameImagesToScan -= imageScan;
      const media = readImages(child, Math.min(6, frameImagesRemaining), imageScan);
      frameImagesRemaining -= media.images.length;
      const childPath = [...path, index];
      const timeOrigin = child.defaultView?.performance?.timeOrigin;
      const imageLocator = media.images.some(image => image.url) && Number.isFinite(timeOrigin)
        ? { path: childPath, timeOrigin: String(timeOrigin) } : undefined;
      if (body.text || selection.selection || tables.tables.length || media.images.length ||
          body.textTruncated || selection.selectionTruncated || tables.tablesTruncated || media.imagesTruncated) {
        frames.push({ title: clip(child.title || element.title || '', 512), url, ...body, ...selection, ...tables, ...media, imageLocator });
      }
      readFrames(child, childPath);
    }
  }
  readFrames(document, []);
  const metadata = {
    language: shortText(document.documentElement.lang || "", 64),
    description: shortText(document.head?.querySelector('meta[name="description" i]')?.content || "", 400),
    canonicalUrl: webUrl(document.head?.querySelector('link[rel~="canonical" i]')?.href),
  };
  return { title: clip(document.title, 512), url: location.href, ...mainText, ...mainSelection,
    truncated: mainText.textTruncated || mainSelection.selectionTruncated,
    links, linksTruncated, ...mainTables, metadata, ...mainImages, frames, framesOmitted };
})()
