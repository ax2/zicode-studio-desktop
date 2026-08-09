import { isSuperAgentEnabled, setSuperAgentEnabled } from "../super-agent/settings.js";
import { t } from "../i18n.js";

class ChatSettingsPanel extends HTMLElement {
  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.innerHTML = `
      <div class="settings-body">
        <div class="settings-section">
          <div class="settings-section-title chat-settings-title-row">
            Agent Inbox <span class="ui-badge chat-settings-beta-badge">${t("Beta")}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label settings-label-stack">
              <span class="settings-label-main">${t("Start automatically")}</span>
              <span class="settings-label-sub">${t("Start Agent Inbox when ZiCode Studio Desktop starts.")}</span>
            </span>
            <button class="settings-toggle" id="toggle-super-agent"></button>
          </div>
          <p class="settings-help">${t("External messages land in the isolated Agent Inbox; dispatching tasks to project instances still needs local confirmation.")}</p>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">${t("Feishu")}</div>
          <p class="settings-help">${t("Uses a Feishu Open Platform app WebSocket; no public callback URL needed.")}</p>
          <form class="chat-platform-form" data-service="feishu">
            <input class="ui-input" data-field="appId" placeholder="${t("App ID (cli_xxx)")}" autocomplete="off" />
            <input class="ui-input" data-field="appSecret" placeholder="App Secret" type="password" autocomplete="off" />
            <input class="ui-input" data-field="channelId" placeholder="${t("Channel chat_id")}" autocomplete="off" />
            <input class="ui-input" data-field="allowedUserId" placeholder="${t("Allowed user open_id (optional)")}" autocomplete="off" />
            <button type="submit" class="ui-button ui-button--primary" data-service="feishu">${t("Save Feishu configuration")}</button>
          </form>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">${t("WeCom")}</div>
          <p class="settings-help">${t("Uses the official WeCom bot long connection. Fill userid for 1:1 chats and chatid for groups.")}</p>
          <form class="chat-platform-form" data-service="wecom">
            <input class="ui-input" data-field="botId" placeholder="Bot ID" autocomplete="off" />
            <input class="ui-input" data-field="secret" placeholder="Secret" type="password" autocomplete="off" />
            <input class="ui-input" data-field="channelId" placeholder="${t("userid or chatid")}" autocomplete="off" />
            <input class="ui-input" data-field="allowedUserId" placeholder="${t("Allowed user userid (optional)")}" autocomplete="off" />
            <button type="submit" class="ui-button ui-button--primary" data-service="wecom">${t("Save WeCom configuration")}</button>
          </form>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">${t("Configured platforms")}</div>
          <div class="settings-save-status hidden" data-status aria-live="polite"></div>
          <div class="chat-accounts-list" data-accounts-list></div>
        </div>

        <details class="settings-section chat-advanced-config">
          <summary class="settings-section-title">${t("Advanced configuration")}</summary>
          <p class="settings-help">${t("Configuration is stored in the ZiCode Studio Desktop data directory, not ~/.pi.")}</p>
          <textarea class="ui-textarea config-editor-textarea settings-config-textarea"
            data-textarea spellcheck="false" autocomplete="off"></textarea>
          <button class="ui-button ui-button--primary" data-action="save-raw">${t("Save raw configuration")}</button>
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
      if (button.dataset.action === "remove-platform") {
        void this._removePlatform(button.dataset.accountId);
      }
      if (button.dataset.action === "save-raw") void this._saveRaw();
    });
    this.addEventListener("submit", (event) => {
      const form = event.target.closest(".chat-platform-form");
      if (!form) return;
      event.preventDefault();
      void this._savePlatform(form.dataset.service);
    });
    this._handleConfigGatewayReady = () => void this._load();
    window.addEventListener("picot-config-gateway-ready", this._handleConfigGatewayReady);
    if (typeof window.__picotConfigCall === "function") void this._load();
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
      this._clearStatus();
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
      this._show(t("Fill in the platform credentials and channel ID."), true);
      return;
    }
    const serviceLabel = service === "feishu" ? t("Feishu") : t("WeCom");
    config.accounts[accountId] = {
      service,
      name: serviceLabel,
      ...credentials,
      access: { ignoreBots: true },
      channels: {
        main: {
          id: channelId,
          name: t("Main channel"),
          dm: true,
          access: {
            ignoreBots: true,
            ...(allowedUserId ? { allowedUserIds: [allowedUserId] } : {}),
          },
        },
      },
    };
    await this._persist(
      config,
      t("{service} configuration saved.").replace("{service}", serviceLabel),
    );
    form.querySelectorAll("input").forEach((input) => {
      input.value = "";
    });
  }

  async _removePlatform(accountId) {
    const config = this._readConfig();
    delete config.accounts[accountId];
    await this._persist(config, t("Platform configuration removed."));
  }

  async _saveRaw() {
    try {
      const config = this._readConfig();
      const invalid = Object.values(config.accounts).some(
        (account) => !["feishu", "wecom"].includes(account?.service),
      );
      if (invalid) throw new Error(t("Only Feishu and WeCom accounts are supported."));
      await this._persist(config, t("Raw configuration saved."));
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
                    <span class="chat-account-name">${account.service === "feishu" ? t("Feishu") : t("WeCom")}</span>
                    <button class="ui-button ui-button--danger" data-action="remove-platform"
                      data-account-id="${esc(id)}">${t("Remove")}</button>
                  </div>
                  <div class="chat-account-detail">${t("Account:")} <code>${esc(id)}</code></div>
                  <div class="chat-account-detail">${t("Channels:")} ${Object.keys(account.channels || {}).length}</div>
                </div>`,
            )
            .join("")
        : `<p class="settings-help">${t("No messaging platform configured yet.")}</p>`;
    } catch {
      this._accountsEl.innerHTML = "";
    }
  }

  _show(message, error = false) {
    this._statusEl.textContent = message;
    this._statusEl.style.color = error ? "var(--color-danger)" : "var(--color-success)";
    this._statusEl.classList.remove("hidden");
  }

  _clearStatus() {
    this._statusEl.textContent = "";
    this._statusEl.style.removeProperty("color");
    this._statusEl.classList.add("hidden");
  }
}

async function callPicotConfig(op, params = {}) {
  const result = await window.__picotConfigCall(op, params);
  if (!result?.ok) throw new Error(result?.error || `${op} failed`);
  return result.data || {};
}

async function readChatConfig() {
  if (typeof window.__picotConfigCall === "function") return callPicotConfig("read_chat_config");
  throw new Error(t("ZiCode Studio Desktop configuration service is not connected yet"));
}

async function writeChatConfig(content) {
  if (typeof window.__picotConfigCall === "function") {
    return callPicotConfig("write_chat_config", { content });
  }
  throw new Error(t("ZiCode Studio Desktop configuration service is not connected yet"));
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
