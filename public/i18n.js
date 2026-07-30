const LOCALE_COOKIE = "zicode-studio-locale";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;

export const supportedLocales = {
  "zh-CN": "简体中文",
  en: "English",
};

const zhCN = {
  "Starting session…": "正在启动会话…",
  "Loading sessions...": "正在加载会话…",
  "No saved sessions": "暂无已保存会话",
  Connected: "已连接",
  Connecting: "连接中",
  "Connecting...": "连接中…",
  Disconnected: "已断开",
  "Welcome to ZiCode Studio Desktop": "欢迎使用 ZiCode Studio Desktop",
  "Type a message below to start chatting with Pi, or select a session from the sidebar.":
    "在下方输入消息即可开始与 Pi 对话，或从侧边栏选择一个会话。",
  "Keyboard shortcuts": "键盘快捷键",
  "Focus input": "聚焦输入框",
  Abort: "中止",
  "Abort (Esc)": "中止（Esc）",
  "New ↓": "新消息 ↓",
  Settings: "设置",
  General: "通用",
  Extensions: "扩展",
  Usage: "用量",
  Configuration: "配置",
  "Agent Inbox": "智能收件箱",
  "Back to chat": "返回对话",
  "Toggle sidebar": "切换侧边栏",
  "Refresh sessions": "刷新会话",
  "Open folder": "打开文件夹",
  "Open folder as workspace": "将文件夹作为工作区打开",
  "Open workspace": "打开工作区",
  "Open workspace in app": "在应用中打开工作区",
  "Choose app": "选择应用",
  "Choose app to open workspace": "选择用于打开工作区的应用",
  Files: "文件",
  "Toggle file browser": "切换文件浏览器",
  "Close file browser": "关闭文件浏览器",
  "Parent directory": "上级目录",
  "Open in file manager": "在文件管理器中打开",
  "Workspace path": "工作区路径",
  "Git branch": "Git 分支",
  "Session cost": "会话费用",
  "Context usage": "上下文用量",
  "Context Window": "上下文窗口",
  "Conversation navigator": "对话导航",
  Appearance: "外观",
  Theme: "主题",
  Language: "语言",
  Agent: "智能体",
  "Auto-compaction": "自动压缩上下文",
  "Thinking effort": "思考强度",
  "Reasoning depth": "推理深度",
  "Thinking effort controls reasoning depth. Click to cycle.":
    "思考强度决定推理深度，点击可循环切换。",
  "Thinking effort: off. Click to cycle reasoning depth.":
    "思考强度：关闭。点击可循环切换推理深度。",
  "Show thinking": "显示思考过程",
  "Think off": "思考关闭",
  Faster: "更快",
  Smarter: "更强",
  minimal: "最少",
  low: "较低",
  medium: "中等",
  high: "较高",
  off: "关闭",
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
  Update: "更新",
  "Set key": "设置密钥",
  unknown: "未选择模型",
  Loading: "加载中",
  "Loading…": "加载中…",
  "Loading...": "加载中…",
  Unavailable: "不可用",
  Retry: "重试",
  "API Keys": "API 密钥",
  Models: "模型",
  Provider: "渠道",
  "Base URL": "基础地址",
  "App version": "应用版本",
  "Pi version": "Pi 版本",
  "Check for updates": "检查更新",
  Updates: "更新",
  "Desktop version": "桌面版本",
  "Click to check": "点击检查",
  "Check now": "立即检查",
  "Beta updates": "测试版更新",
  "Receive prerelease desktop builds": "接收桌面端预发布版本",
  "Receive beta updates": "接收测试版更新",
  "Automatic updates are not configured": "自动更新尚未配置",
  "Use GitHub Releases": "使用 GitHub Releases",
  "No configured channels.": "尚未配置消息渠道。",
  Back: "返回",
  "Browse Community Packages": "浏览社区包",
  "Discover extensions, skills, themes, and prompts from the Pi ecosystem. Install with one click.":
    "发现 Pi 生态中的扩展、技能、主题和提示词，并可一键安装。",
  "Search packages...": "搜索社区包…",
  All: "全部",
  Skills: "技能",
  Themes: "主题",
  Prompts: "提示词",
  "Installed only": "仅显示已安装",
  "Sort packages": "社区包排序",
  "Most downloads": "下载量最多",
  "Name (A–Z)": "名称（A–Z）",
  "Recently updated": "最近更新",
  Authentication: "身份验证",
  "Keys are stored locally in": "密钥保存在本地：",
  ". The desktop app stores keys in this scene's isolated agent directory so they persist across launches.":
    "。桌面应用将密钥保存在当前场景的隔离目录中，以便跨启动保留。",
  "Loading providers…": "正在加载模型渠道…",
  "Search providers…": "搜索模型渠道…",
  "Search providers": "搜索模型渠道",
  "No configured providers. Search or show all providers to add a key.":
    "尚未配置内置渠道。可搜索或显示全部渠道以添加密钥。",
  "Show configured only": "仅显示已配置渠道",
  "Show all providers": "显示全部渠道",
  Protection: "保护",
  "Require login": "需要登录",
  "Custom model channels": "自定义模型渠道",
  "Configure an OpenAI-, Anthropic-, or Google-compatible endpoint for this scene. Credentials are stored separately from":
    "为当前场景配置兼容 OpenAI、Anthropic 或 Google 的服务地址。凭据与",
  "Channel ID": "渠道 ID",
  "API protocol": "API 协议",
  "API key": "API 密钥",
  "Leave blank to keep current key": "留空则保留当前密钥",
  "Models (one ID per line)": "模型（每行一个 ID）",
  "Save channel": "保存渠道",
  "Agent config file": "智能体配置文件",
  "Advanced provider JSON": "高级渠道 JSON",
  "Providers file": "渠道配置文件",
  "Insert example": "插入示例",
  "models.json docs": "models.json 文档",
  "to add custom providers (Ollama, vLLM, LM Studio, OpenAI-compatible proxies, OpenRouter routing overrides, etc). See the":
    "以添加自定义渠道（Ollama、vLLM、LM Studio、OpenAI 兼容代理、OpenRouter 路由覆盖等）。请参阅",
  "for the full schema. Changes are picked up immediately — no restart needed.":
    "了解完整格式。修改会立即生效，无需重启。",
  "New session scene": "新会话场景",
  "Each scene has isolated model channels, credentials, extensions, and sessions. The selection applies when you create the next session.":
    "每个场景拥有隔离的模型渠道、凭据、扩展和会话。该选择将在创建下一个会话时生效。",
  Scene: "场景",
  Programming: "编程",
  Finance: "金融",
  Creation: "创作",
  "Code, debugging, repositories, and technical research.":
    "适用于编码、调试、代码仓库和技术研究。",
  "Financial analysis with a read-only local tool policy.":
    "适用于金融分析，并采用只读的本地工具策略。",
  "Writing, ideation, visual direction, and content production.":
    "适用于写作、构思、视觉方向和内容创作。",
  "New custom scene": "新建自定义场景",
  "Scene ID": "场景 ID",
  Name: "名称",
  Description: "描述",
  "Scene system instructions": "场景系统指令",
  "Allowed tools (comma-separated; blank allows all)": "允许的工具（逗号分隔，留空表示全部允许）",
  "Save scene": "保存场景",
  "Agent Configuration": "智能体配置",
  Chat: "对话",
  Commands: "命令",
  "Open commands": "打开命令",
  "Switch model": "切换模型",
  model: "模型",
  "Type a message, or use / to call a skill…": "输入消息，或使用 / 调用技能…",
  "Send message": "发送消息",
  "Attach image": "添加图片",
  "Voice input": "语音输入",
  "Search...": "搜索…",
  "Clear search": "清除搜索",
  "Search tasks": "搜索任务",
  "Search tasks and messages…": "搜索任务和消息…",
  "Search results": "搜索结果",
  "Delete selected": "删除所选项",
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
  return dictionaries[activeLocale]?.[normalizeSource(source)] ?? source;
}

function translateTextNode(node) {
  if (!originalText.has(node)) originalText.set(node, node.nodeValue ?? "");
  const source = originalText.get(node);
  const trimmed = source.trim();
  if (!trimmed) return;
  const translated = dictionaries[activeLocale]?.[normalizeSource(trimmed)] ?? trimmed;
  node.nodeValue = source.replace(trimmed, translated);
}

function normalizeSource(source) {
  return String(source).trim().replace(/\s+/g, " ");
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
    element.setAttribute(
      attribute,
      dictionaries[activeLocale]?.[normalizeSource(source)] ?? source,
    );
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
