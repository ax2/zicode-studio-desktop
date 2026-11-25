(() => {
  const excluded = 'script,style,noscript,template,input,textarea,select,option,[contenteditable], [hidden], [inert], [aria-hidden="true"]';
  const styleOf = element => element.ownerDocument?.defaultView?.getComputedStyle(element) ?? getComputedStyle(element);
  const allowed = node => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || element.closest(excluded)) return false;
    const style = styleOf(element);
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
  let structureRemaining = 24000;
  let selectionRemaining = 8192;
  function renderedChildren(element) {
    if (element.shadowRoot) return element.shadowRoot.childNodes;
    if (element.localName === "slot" && element.getRootNode().host) {
      const assigned = element.assignedNodes();
      if (assigned.length) return assigned;
    }
    return element.childNodes;
  }
  function composedParent(node) {
    return node.assignedSlot || node.parentElement || node.getRootNode().host;
  }
  function readText(doc, limit) {
    const charLimit = Math.min(limit, textRemaining);
    const root = doc.body || doc.documentElement;
    const pending = [{ nodes: [root].values(), flow: root }];
    let text = '', textTruncated = false, textRange;
    let previousFlow, spacePending = false, lineBreaks = 0;
    while (pending.length) {
      const { nodes, flow } = pending.at(-1);
      const next = nodes.next();
      if (next.done) { pending.pop(); continue; }
      if (structureRemaining === 0) { textTruncated = true; break; }
      structureRemaining--;
      const node = next.value;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches(excluded)) continue;
        if (node.localName === 'br') {
          if (text && allowed(node)) lineBreaks++;
          continue;
        }
        const display = styleOf(node).display;
        // Keep composed slot sources distinct while joining inline content within each flow.
        const inline = !display || /^(inline(?:-| |$)|contents$|ruby(?:-|$))/.test(display);
        const childFlow = inline && node.localName !== 'slot' ? flow : node;
        pending.push({ nodes: renderedChildren(node).values(), flow: childFlow });
        continue;
      }
      if (node.nodeType !== Node.TEXT_NODE) continue;
      if (nodesRemaining === 0) { textTruncated = true; break; }
      nodesRemaining--;
      const raw = node.nodeValue || '';
      if (!raw) continue;
      const parent = composedParent(node);
      if (!parent) continue;
      if (node.parentElement === parent && parent.getClientRects().length > 0) {
        if (!allowed(node)) continue;
      } else {
        // A slot, a display:contents parent, or a bare shadow text node has no useful parent box.
        if (styleOf(parent).visibility !== 'visible') continue;
        let hidden = false;
        for (let ancestor = parent; ancestor; ancestor = composedParent(ancestor)) {
          const style = styleOf(ancestor);
          if (style.display === 'none' || style.opacity === '0' || style.contentVisibility === 'hidden' ||
              (ancestor.getClientRects().length > 0 &&
               ancestor.checkVisibility?.({ opacityProperty: true }) === false)) {
            hidden = true;
            break;
          }
          if (ancestor.getClientRects().length > 0 && ancestor.checkVisibility) break;
        }
        if (hidden) continue;
        textRange ??= doc.createRange();
        textRange.selectNodeContents(node);
        if (!textRange.getClientRects().length) continue;
      }
      const whitespace = styleOf(parent).whiteSpace;
      const preserveSpace = /^(pre|pre-wrap|break-spaces)$/.test(whitespace);
      const normalized = preserveSpace ? raw : raw.replace(whitespace === 'pre-line' ? /[ \t\f]+/g : /[ \t\r\n\f]+/g, ' ');
      const part = preserveSpace ? normalized : normalized.replace(/^ | $/g, '');
      if (!part) {
        if (text && previousFlow === flow) spacePending = true;
        continue;
      }
      let separator = '';
      if (text && lineBreaks) separator = '\n'.repeat(lineBreaks);
      else if (text && previousFlow !== flow && !text.endsWith('\n')) separator = '\n';
      else if (text && previousFlow === flow && !text.endsWith('\n') &&
               (spacePending || (!preserveSpace && normalized.startsWith(' ')))) separator = ' ';

      const value = separator + part;
      const remaining = charLimit - text.length;
      if (value.length > remaining) { text += clip(value, remaining); textTruncated = true; break; }
      text += value;
      previousFlow = flow;
      spacePending = !preserveSpace && normalized.endsWith(' ');
      lineBreaks = 0;
    }
    if (!textTruncated && text && !text.endsWith('\n') && text.length < charLimit) text += '\n';
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
    const ancestor = range.commonAncestorContainer;
    const container = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement;
    if (!container || container.closest(editable)) return empty;
    const controls = container.querySelectorAll(editable);
    if (controls.length > 256 || Array.from(controls).some(element => range.intersectsNode(element))) return empty;
    const value = selection.toString();
    const selected = clip(value, selectionRemaining);
    selectionRemaining -= selected.length;
    return { selection: selected, selectionTruncated: selected.length < value.length };
  }
  const mainText = readText(document, textRemaining);
  const mainSelection = readSelection(document, getSelection());
  let referenceStructureRemaining = 24000;
  let tablesRemaining = 4;
  let tablesToScan = 100;
  let tableTextRemaining = 3600;
  function readReferences(doc, linkLimit, imageLimit, scan) {
    const links = [], images = [], tables = [];
    const linkUrls = new Set(), imageKeys = new Set();
    const pending = [{ nodes: [doc.body || doc.documentElement].values(), withinTable: false }];
    let linksTruncated = false, imagesTruncated = false, tablesTruncated = false;
    let tablesDone = false;
    while (pending.length && !(linksTruncated && imagesTruncated && tablesDone)) {
      const { nodes, withinTable } = pending.at(-1);
      const next = nodes.next();
      if (next.done) { pending.pop(); continue; }
      if (referenceStructureRemaining === 0) { linksTruncated = imagesTruncated = tablesTruncated = true; break; }
      referenceStructureRemaining--;
      const element = next.value;
      if (element.nodeType !== Node.ELEMENT_NODE || element.matches(excluded)) continue;
      const isTable = element.localName === "table" && !!element.rows;
      pending.push({ nodes: renderedChildren(element).values(), withinTable: withinTable || isTable });
      if (element.localName === "a" && !linksTruncated && typeof element.href === "string" && element.href) {
        if (scan.links === 0) { linksTruncated = true; continue; }
        scan.links--;
        if (!visible(element) || element.querySelector('input,textarea,select,[contenteditable]')) continue;
        const url = webUrl(element.href);
        if (!url || linkUrls.has(url)) continue;
        if (links.length === linkLimit) { linksTruncated = true; continue; }
        linkUrls.add(url);
        links.push({ label: shortText(element.innerText, 120), url });
      } else if (element.localName === "img" && !imagesTruncated) {
        if (scan.images === 0) { imagesTruncated = true; continue; }
        scan.images--;
        const { naturalWidth: width, naturalHeight: height } = element;
        if (!element.complete || !width || !height || width > 100000 || height > 100000 || !visible(element)) continue;
        const alt = shortText(element.alt, 160);
        // Only the selected, already-loaded srcset candidate is relevant.
        const source = webUrl(element.currentSrc);
        // Pixel requests resolve by URL and size in the ordinary document image collection.
        const url = element.getRootNode() === doc ? source : null;
        const key = source ? JSON.stringify([source, alt, width, height, url !== null]) : null;
        if (key && imageKeys.has(key)) continue;
        if (images.length === imageLimit) { imagesTruncated = true; continue; }
        if (key) imageKeys.add(key);
        images.push({ alt, width, height, url });
      } else if (isTable && !tablesDone) {
        if (tablesToScan === 0) { tablesTruncated = tablesDone = true; continue; }
        tablesToScan--;
        if (withinTable || !visible(element)) continue;
        if (tablesRemaining === 0) { tablesTruncated = tablesDone = true; continue; }
        const { result, truncated } = readTable(element);
        tablesTruncated ||= truncated;
        if (result) {
          tablesRemaining--;
          tables.push(result);
        }
      }
    }
    return { links, linksTruncated, images, imagesTruncated, tables, tablesTruncated };
  }
  function readTable(table) {
    let tablesTruncated = false;
    const readTableText = element => {
      const nodes = table.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
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
    const rows = [];
    if (table.rows.length > 80) tablesTruncated = true;
    for (let i = 0; i < Math.min(table.rows.length, 80); i++) {
      if (!visible(table.rows[i])) continue;
      if (rows.length === 16) { tablesTruncated = true; break; }
      rows.push(table.rows[i]);
    }
    if (!rows.length) return { truncated: tablesTruncated };
    const caption = table.caption && visible(table.caption) ? readTableText(table.caption) : "";
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
        grid[r][column] = visible(cell) ? readTableText(cell) : "";
        columns = Math.max(columns, right);
        column = right;
      }
    }
    const result = columns
      ? { caption, firstRowHeader, rows: grid.map(row => row.slice(0, columns).map(cell => cell ?? "")) }
      : undefined;
    return { result, truncated: tablesTruncated };
  }
  const mainReferences = readReferences(document, 20, 12, { links: 1000, images: 400 });
  const frames = [];
  let framesOmitted = false;
  let framesToScan = 24;
  const origin = location.origin;
  let frameLinksRemaining = 12;
  const frameReferenceScan = { links: 400, images: 400 };
  let frameImagesRemaining = 12;
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
      const references = readReferences(child, Math.min(6, frameLinksRemaining),
        Math.min(6, frameImagesRemaining), frameReferenceScan);
      frameLinksRemaining -= references.links.length;
      frameImagesRemaining -= references.images.length;
      const childPath = [...path, index];
      const timeOrigin = child.defaultView?.performance?.timeOrigin;
      const imageLocator = references.images.some(image => image.url) && Number.isFinite(timeOrigin)
        ? { path: childPath, timeOrigin: String(timeOrigin) } : undefined;
      if (body.text || selection.selection || references.tables.length || references.images.length ||
          references.links.length || references.linksTruncated || body.textTruncated ||
          selection.selectionTruncated || references.tablesTruncated || references.imagesTruncated) {
        frames.push({ title: clip(child.title || element.title || '', 512), url, ...body, ...selection, ...references, imageLocator });
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
    ...mainReferences, metadata, frames, framesOmitted };
})()
