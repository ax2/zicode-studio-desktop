// Protect literal punctuation before Markdown rules, then restore escaped HTML text.
// Code spans keep their own literal semantics. Only the common named entities used
// by our text exporters are decoded; this is not a general HTML parser.
export function protectMarkdownLiterals(text, escapeHtml) {
  let prefix = "\uE000";
  while (text.includes(prefix)) prefix += "\uE000";
  const values = [];
  const entities = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
  const protectedText = text.replace(/`[^`]+`|\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|&(amp|lt|gt|quot|apos);/g, (match, punctuation) => {
    if (match.startsWith("`")) return match;
    const index = values.push(punctuation ?? entities[match]) - 1;
    return `${prefix}${index}\uE001`;
  });
  const token = new RegExp(`${prefix}(\\d+)\uE001`, "g");
  return { text: protectedText, restore: value => value.replace(token, (_, index) => escapeHtml(values[Number(index)])) };
}
