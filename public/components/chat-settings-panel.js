import { isSuperAgentEnabled, setSuperAgentEnabled } from "../super-agent/settings.js";

class ChatSettingsPanel extends HTMLElement {
  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.innerHTML = `
      <div class="settings-body">
        <div class="settings-section">
          <div class="settings-section-title chat-settings-title-row">
            Agent Inbox <span class="ui-badge chat-settings-beta-badge">测试版</span>
          </div>
          <div class="settings-row">
            <span class="settings-label settings-label-stack">
              <span class="settings-label-main">自动启动</span>
              <span class="settings-label-sub">ZiCode Studio Desktop 启动时同时启动 Agent Inbox</span>
            </span>
            <button class="settings-toggle" id="toggle-super-agent"></button>
          </div>
          <p class="settings-help">外部消息先进入独立的 Agent Inbox，向项目实例派发任务仍需本机确认。</p>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">飞书</div>
          <p class="settings-help">使用飞书开放平台应用的 WebSocket 长连接，无需公网回调地址。</p>
          <div class="chat-platform-form" data-service="feishu">
            <input class="ui-input" data-field="appId" placeholder="App ID（cli_xxx）" autocomplete="off" />
            <input class="ui-input" data-field="appSecret" placeholder="App Secret" type="password" autocomplete="off" />
            <input class="ui-input" data-field="channelId" placeholder="会话 chat_id" autocomplete="off" />
            <input class="ui-input" data-field="allowedUserId" placeholder="允许的用户 open_id（可选）" autocomplete="off" />
            <button class="ui-button ui-button--primary" data-action="save-platform" data-service="feishu">保存飞书配置</button>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">企业微信</div>
          <p class="settings-help">使用企业微信智能机器人的官方长连接。单聊填写 userid，群聊填写 chatid。</p>
          <div class="chat-platform-form" data-service="wecom">
            <input class="ui-input" data-field="botId" placeholder="Bot ID" autocomplete="off" />
            <input class="ui-input" data-field="secret" placeholder="Secret" type="password" autocomplete="off" />
            <input class="ui-input" data-field="channelId" placeholder="userid 或 chatid" autocomplete="off" />
            <input class="ui-input" data-field="allowedUserId" placeholder="允许的用户 userid（可选）" autocomplete="off" />
            <button class="ui-button ui-button--primary" data-action="save-platform" data-service="wecom">保存企业微信配置</button>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">已配置平台</div>
          <div class="settings-save-status hidden" data-status aria-live="polite"></div>
          <div class="chat-accounts-list" data-accounts-list></div>
        </div>

        <details class="settings-section chat-advanced-config">
          <summary class="settings-section-title">高级配置</summary>
          <p class="settings-help">配置保存在 ZiCode Studio Desktop 专用数据目录，不使用 ~/.pi。</p>
          <textarea class="ui-textarea config-editor-textarea settings-config-textarea"
            data-textarea spellcheck="false" autocomplete="off"></textarea>
          <button class="ui-button ui-button--primary" data-action="save-raw">保存原始配置</button>
        </details>
      </div>
    `;

    this._textarea = this.querySelector("[data-textarea]");
    this._statusEl = this.querySelector("[data-status]");
    this._accountsEl = this.querySelector("[data-accounts-list]");
    this._setupSuperAgentToggle();
    this.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "save-platform") {
        void this._savePlatform(button.dataset.service);
      }
      if (button.dataset.action === "remove-platform") {
        void this._removePlatform(button.dataset.accountId);
      }
      if (button.dataset.action === "save-raw") void this._saveRaw();
    });
    this._handleConfigGatewayReady = () => void this._load();
    window.addEventListener("picot-config-gateway-ready", this._handleConfigGatewayReady);
    void this._load();
  }

  disconnectedCallback() {
    window.removeEventListener("picot-config-gateway-ready", this._handleConfigGatewayReady);
  }

  _setupSuperAgentToggle() {
    const button = this.querySelector("#toggle-super-agent");
    const enabled = isSuperAgentEnabled();
    button.classList.toggle("on", enabled);
    button.setAttribute("aria-checked", String(enabled));
    button.setAttribute("role", "switch");
    button.addEventListener("click", () => {
      const next = !button.classList.contains("on");
      button.classList.toggle("on", next);
      button.setAttribute("aria-checked", String(next));
      setSuperAgentEnabled(next);
      window.dispatchEvent(
        new CustomEvent("picot-super-agent-autostart-changed", { detail: { enabled: next } }),
      );
    });
  }

  async _load() {
    try {
      const { content } = await readChatConfig();
      this._textarea.value = content || '{"botName":"ZiCode","accounts":{}}';
      this._renderAccounts();
    } catch (error) {
      this._show(messageFromError(error), true);
    }
  }

  _readConfig() {
    const parsed = JSON.parse(this._textarea.value || "{}");
    parsed.botName ||= "ZiCode";
    parsed.accounts ||= {};
    return parsed;
  }

  async _savePlatform(service) {
    const form = this.querySelector(`.chat-platform-form[data-service="${service}"]`);
    const value = (field) => form.querySelector(`[data-field="${field}"]`).value.trim();
    const channelId = value("channelId");
    const allowedUserId = value("allowedUserId");
    const config = this._readConfig();
    const accountId = service === "feishu" ? "feishu-main" : "wecom-main";
    const credentials =
      service === "feishu"
        ? { appId: value("appId"), appSecret: value("appSecret") }
        : { botId: value("botId"), secret: value("secret") };
    if (!channelId || Object.values(credentials).some((item) => !item)) {
      this._show("请填写平台凭证和会话 ID。", true);
      return;
    }
    config.accounts[accountId] = {
      service,
      name: service === "feishu" ? "飞书" : "企业微信",
      ...credentials,
      access: { ignoreBots: true },
      channels: {
        main: {
          id: channelId,
          name: "主会话",
          dm: true,
          access: {
            ignoreBots: true,
            ...(allowedUserId ? { allowedUserIds: [allowedUserId] } : {}),
          },
        },
      },
    };
    await this._persist(config, `${service === "feishu" ? "飞书" : "企业微信"}配置已保存。`);
    form.querySelectorAll("input").forEach((input) => {
      input.value = "";
    });
  }

  async _removePlatform(accountId) {
    const config = this._readConfig();
    delete config.accounts[accountId];
    await this._persist(config, "平台配置已移除。");
  }

  async _saveRaw() {
    try {
      const config = this._readConfig();
      const invalid = Object.values(config.accounts).some(
        (account) => !["feishu", "wecom"].includes(account?.service),
      );
      if (invalid) throw new Error("仅支持飞书和企业微信账号。");
      await this._persist(config, "原始配置已保存。");
    } catch (error) {
      this._show(messageFromError(error), true);
    }
  }

  async _persist(config, message) {
    const content = `${JSON.stringify(config, null, 2)}\n`;
    await writeChatConfig(content);
    this._textarea.value = content;
    this._renderAccounts();
    this._show(message);
    window.dispatchEvent(new CustomEvent("picot-chat-config-updated"));
  }

  _renderAccounts() {
    try {
      const accounts = Object.entries(this._readConfig().accounts);
      this._accountsEl.innerHTML = accounts.length
        ? accounts
            .map(
              ([id, account]) => `
                <div class="chat-account-card">
                  <div class="chat-account-header">
                    <span class="chat-account-name">${account.service === "feishu" ? "飞书" : "企业微信"}</span>
                    <button class="ui-button ui-button--danger" data-action="remove-platform"
                      data-account-id="${esc(id)}">移除</button>
                  </div>
                  <div class="chat-account-detail">账号：<code>${esc(id)}</code></div>
                  <div class="chat-account-detail">会话数：${Object.keys(account.channels || {}).length}</div>
                </div>`,
            )
            .join("")
        : '<p class="settings-help">尚未配置消息平台。</p>';
    } catch {
      this._accountsEl.innerHTML = "";
    }
  }

  _show(message, error = false) {
    this._statusEl.textContent = message;
    this._statusEl.style.color = error ? "var(--color-danger)" : "var(--color-success)";
    this._statusEl.classList.remove("hidden");
  }
}

async function callPicotConfig(op, params = {}) {
  const result = await window.__picotConfigCall(op, params);
  if (!result?.ok) throw new Error(result?.error || `${op} failed`);
  return result.data || {};
}

async function readChatConfig() {
  if (typeof window.__picotConfigCall === "function") return callPicotConfig("read_chat_config");
  const response = await fetch("/api/chat-config");
  if (!response.ok) throw new Error("读取消息平台配置失败");
  return response.json();
}

async function writeChatConfig(content) {
  if (typeof window.__picotConfigCall === "function") {
    return callPicotConfig("write_chat_config", { content });
  }
  const response = await fetch("/api/chat-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error("保存消息平台配置失败");
}

function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

customElements.define("chat-settings-panel", ChatSettingsPanel);
