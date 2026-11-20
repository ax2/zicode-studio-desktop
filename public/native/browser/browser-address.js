import { t } from "../../i18n.js";

export const searchProviders = [
  ["bing", "Bing", "https://www.bing.com/search", "q"],
  ["baidu", "Baidu", "https://www.baidu.com/s", "wd"],
  ["google", "Google", "https://www.google.com/search", "q"],
  ["duckDuckGo", "DuckDuckGo", "https://duckduckgo.com/", "q"],
];

// Only an explicit submit calls this resolver; typing never contacts a provider.
export function resolveBrowserAddress(raw, engine = "bing") {
  const input = raw.trim();
  const invalid = () => { throw new Error(t("Enter a valid web address or search query.")); };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters before URL parsing or search submission.
  if (!input || new TextEncoder().encode(input).length > 16384 || /[\u0000-\u001f\u007f]/.test(input)) return invalid();
  if (/^(?:[a-z]:[\\/]|[\\/]|~[\\/])/i.test(input)) return invalid();
  const queryOperator = /^(?:site|filetype|intitle|inurl|before|after):/i.test(input);
  const hostPort = /^(?:localhost|[\w.-]+|\[[\da-f:]+\]):\d+(?:[/?#]|$)/i.test(input);
  const scheme = !queryOperator && !hostPort && /^[a-z][a-z\d+.-]*:/i.test(input);
  const address = !queryOperator && (hostPort || (!/\s/.test(input) && /^(?:localhost(?:[/?#]|$)|\[|[^/?#]+\.[^/?#]+)/i.test(input)));
  if (scheme || address) {
    let url;
    try { url = new URL(scheme ? input : `https://${input}`); } catch { return invalid(); }
    if (url.href === "about:blank") return url.href;
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return invalid();
    return url.href;
  }
  if (new TextEncoder().encode(input).length > 4096) return invalid();
  const provider = searchProviders.find(([id]) => id === engine);
  if (!provider) return invalid();
  const url = new URL(provider[2]); url.searchParams.set(provider[3], input);
  return url.href;
}
