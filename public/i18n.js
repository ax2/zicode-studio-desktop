const LOCALE_COOKIE = "zicode-studio-locale";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;

export const supportedLocales = {
  "zh-CN": "简体中文",
  en: "English",
};

const zhCN = {
  Settings: "设置",
  General: "通用",
  Extensions: "扩展",
  Usage: "用量",
  Configuration: "配置",
  "Agent Inbox": "智能收件箱",
  "Back to chat": "返回对话",
  Appearance: "外观",
  Theme: "主题",
  Language: "语言",
  Agent: "智能体",
  "Auto-compaction": "自动压缩上下文",
  "Thinking effort": "思考强度",
  "Reasoning depth": "推理深度",
  Faster: "更快",
  Smarter: "更强",
  "Start automatically": "自动启动",
  "New Session": "新建会话",
  "New session": "新建会话",
  Search: "搜索",
  "Search sessions": "搜索会话",
  "Model channels": "模型渠道",
  "Add channel": "添加渠道",
  Save: "保存",
  Cancel: "取消",
  Remove: "移除",
  Edit: "编辑",
  Loading: "加载中",
  "Loading…": "加载中…",
  Unavailable: "不可用",
  "API Keys": "API 密钥",
  Models: "模型",
  Provider: "渠道",
  "Base URL": "基础地址",
  "App version": "应用版本",
  "Pi version": "Pi 版本",
  "Check for updates": "检查更新",
  "No configured channels.": "尚未配置消息渠道。",
  "Back": "返回",
};

const dictionaries = { "zh-CN": zhCN, en: {} };
const originalText = new WeakMap();
const originalAttributes = new WeakMap();
let activeLocale = readLocaleCookie();
let observer;

function readLocaleCookie() {
  try {
    const entry = document.cookie
      .split("; ")
      .find((value) => value.startsWith(`${LOCALE_COOKIE}=`));
    const locale = entry ? decodeURIComponent(entry.slice(LOCALE_COOKIE.length + 1)) : "";
    return supportedLocales[locale] ? locale : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

function writeLocaleCookie(locale) {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: synchronous cross-port preference storage
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  } catch {
    // Sandboxed WebViews may reject cookies.
  }
}

export function getLocale() {
  return activeLocale;
}

export function t(source) {
  return dictionaries[activeLocale]?.[source] ?? source;
}

function translateTextNode(node) {
  if (!originalText.has(node)) originalText.set(node, node.nodeValue ?? "");
  const source = originalText.get(node);
  const trimmed = source.trim();
  if (!trimmed) return;
  const translated = dictionaries[activeLocale]?.[trimmed] ?? trimmed;
  node.nodeValue = source.replace(trimmed, translated);
}

function translateElement(element) {
  if (element.matches("script, style")) return;
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
  }
  const translatable = ["title", "aria-label", "placeholder"];
  let sources = originalAttributes.get(element);
  if (!sources) {
    sources = {};
    originalAttributes.set(element, sources);
  }
  for (const attribute of translatable) {
    if (!element.hasAttribute(attribute)) continue;
    if (!(attribute in sources)) sources[attribute] = element.getAttribute(attribute);
    const source = sources[attribute];
    element.setAttribute(attribute, dictionaries[activeLocale]?.[source] ?? source);
  }
}

export function translateDocument(root = document.body) {
  if (!root) return;
  if (root instanceof Element) translateElement(root);
  for (const element of root.querySelectorAll("*")) translateElement(element);
  document.documentElement.lang = activeLocale;
}

export function setLocale(locale) {
  if (!supportedLocales[locale]) return;
  activeLocale = locale;
  writeLocaleCookie(locale);
  translateDocument();
  window.dispatchEvent(new CustomEvent("zicode:locale-changed", { detail: { locale } }));
}

export function initializeI18n() {
  translateDocument();
  observer?.disconnect();
  observer = new MutationObserver((records) => {
    observer.disconnect();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) translateDocument(node);
        else if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      }
    }
    observer.observe(document.body, { childList: true, subtree: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
