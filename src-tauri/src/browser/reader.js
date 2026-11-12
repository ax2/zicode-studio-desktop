(() => {
  const skip = 'nav,aside,footer,form,button,input,textarea,select,script,style,noscript,template,iframe,dialog,[contenteditable],[hidden],[inert],[aria-hidden="true"],[role="navigation"],[role="complementary"],[role="banner"],[role="contentinfo"]';
  const blocks = 'h1,h2,h3,h4,h5,h6,p,pre,blockquote,li,figcaption,dt,dd,div,section,article,main';
  const visible = element => !element.closest(skip) && element.getClientRects().length > 0 &&
    element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;

  function kind(element) {
    const tag = element.localName;
    if (/^h[1-6]$/.test(tag)) return tag;
    if (tag === 'pre') return 'code';
    if (tag === 'blockquote') return 'quote';
    if (tag === 'li') return element.parentElement?.localName === 'ol' ? 'ordered' : 'bullet';
    return 'paragraph';
  }

  function read(root, charLimit, nodeLimit, blockLimit) {
    if (!root) return { sections: [], truncated: false, size: 0 };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const sections = [];
    let current, buffer = '', size = 0, visited = 0, truncated = false;
    function flush() {
      if (!current) return;
      const type = kind(current);
      const text = type === 'code' ? buffer.replace(/^\n+|\n+$/g, '') : buffer.trim();
      if (text.trim()) sections.push({ kind: type, text });
      buffer = '';
    }
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (++visited > nodeLimit) { truncated = true; break; }
      const parent = node.parentElement;
      if (!parent || !visible(parent)) continue;
      const header = parent.closest('header');
      if (header && !header.closest('article,main,[role="main"]')) continue;
      const semantic = parent.closest('pre,blockquote,li') ?? parent.closest(blocks) ?? root;
      const group = root.contains(semantic) ? semantic : root;
      if (group !== current) {
        flush(); current = group;
        if (sections.length >= blockLimit) { truncated = true; break; }
      }
      const raw = node.nodeValue ?? '';
      const remaining = charLimit - size;
      const extra = node.previousSibling?.localName === 'br' ? ' ' : '';
      const sample = extra + raw.slice(0, remaining + 1);
      const text = kind(group) === 'code' ? sample : sample.replace(/\s+/g, ' ');
      // Never split a UTF-16 pair at the output boundary.
      const piece = text.slice(0, remaining).replace(/[\uD800-\uDBFF]$/, '');
      size += piece.length;
      buffer += piece;
      if (text.length > remaining || raw.length > remaining + 1) { truncated = true; break; }
    }
    if (sections.length < blockLimit) flush();
    return { sections, truncated, size };
  }

  const candidates = document.querySelectorAll('article,main,[role="main"]');
  let article, main, articleSize = 0, mainSize = 0;
  for (let index = 0; index < Math.min(candidates.length, 24); index++) {
    const element = candidates[index];
    if (!visible(element)) continue;
    const sample = read(element, 2400, 700, 40);
    if (element.localName === 'article') {
      if (sample.size > articleSize) { article = element; articleSize = sample.size; }
    } else if (sample.size > mainSize) { main = element; mainSize = sample.size; }
  }
  const root = article && (!main || (articleSize >= 120 && articleSize >= mainSize / 2)) ? article : main ?? document.body;
  const { sections, truncated } = read(root, 64000, 20000, 400);
  const heading = sections[0]?.kind === 'h1' && sections[0].text.length <= 512 ? sections.shift().text : '';
  const title = heading || document.title.trim().slice(0, 512).replace(/[\uD800-\uDBFF]$/, '');
  return { url: location.href, title, blocks: sections, truncated };
})()
