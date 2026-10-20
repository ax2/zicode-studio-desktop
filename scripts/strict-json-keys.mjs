/** JSON.parse keeps the last duplicate object key. Scan the original, bounded
 * protocol frame so producer and Host agree on its one interpretation. */
export function parseWithoutDuplicateKeys(text) {
  const value = JSON.parse(text);
  let offset = 0;
  const invalid = () => {
    throw new SyntaxError("invalid JSON structure");
  };
  const space = () => {
    while (/\s/u.test(text[offset] ?? "")) offset += 1;
  };
  const string = () => {
    if (text[offset] !== '"') invalid();
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') return text.slice(start, offset);
      if (character === "\\") offset += 1;
    }
    invalid();
  };
  const scan = (depth) => {
    if (depth > 128) invalid();
    space();
    if (text[offset] === "{") {
      offset += 1;
      const keys = new Set();
      space();
      while (text[offset] !== "}") {
        const key = JSON.parse(string());
        if (keys.has(key)) throw new SyntaxError("duplicate JSON object key");
        keys.add(key);
        space();
        if (text[offset++] !== ":") invalid();
        scan(depth + 1);
        space();
        if (text[offset] !== ",") break;
        offset += 1;
        space();
      }
      if (text[offset++] !== "}") invalid();
    } else if (text[offset] === "[") {
      offset += 1;
      space();
      while (text[offset] !== "]") {
        scan(depth + 1);
        space();
        if (text[offset] !== ",") break;
        offset += 1;
        space();
      }
      if (text[offset++] !== "]") invalid();
    } else if (text[offset] === '"') {
      string();
    } else {
      const start = offset;
      while (offset < text.length && !/[\s,\]}]/u.test(text[offset])) offset += 1;
      if (offset === start) invalid();
    }
  };
  scan(0);
  space();
  if (offset !== text.length) invalid();
  return value;
}
