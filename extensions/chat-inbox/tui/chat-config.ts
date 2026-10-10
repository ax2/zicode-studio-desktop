import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  CHAT_CONFIG_PATH,
  loadChatConfig,
  removeAccountStorage,
  removeChannelStorage,
  saveChatConfig,
} from "../config.js";
import type { ChatAccountConfig, ChatConfig, ChatService } from "../core/config-types.js";
import { makeAccountKey, makeChannelKey } from "../core/keys.js";
import { selectItem, showNotice } from "./dialogs.js";

function accountDescription(account: ChatAccountConfig): string {
  return `${account.service === "feishu" ? "飞书" : "企业微信"} • ${Object.keys(account.channels).length} 个会话`;
}

async function addChannel(
  ctx: ExtensionContext,
  config: ChatConfig,
  accountId: string,
): Promise<void> {
  const account = config.accounts[accountId];
  if (!account) return;
  const channelId = (await ctx.ui.input("会话 ID", "飞书 chat_id 或企业微信 userid/chatid"))?.trim();
  if (!channelId) return;
  const label = (await ctx.ui.input("会话名称", "例如：我的私聊"))?.trim() || channelId;
  const allowedUser = (await ctx.ui.input("允许的用户 ID", "可留空；建议限制为自己的用户 ID"))?.trim();
  const channelKey = makeChannelKey(label, channelId);
  account.channels[channelKey] = {
    id: channelId,
    name: label,
    dm: true,
    access: allowedUser ? { allowedUserIds: [allowedUser], ignoreBots: true } : { ignoreBots: true },
  };
  await saveChatConfig(config);
  await showNotice(ctx, "会话已添加", `${accountId}/${channelKey}`, "info");
}

async function configureChannel(
  ctx: ExtensionContext,
  config: ChatConfig,
  accountId: string,
  channelKey: string,
): Promise<void> {
  const account = config.accounts[accountId];
  const channel = account?.channels[channelKey];
  if (!account || !channel) return;
  const ok = await ctx.ui.confirm("删除会话", `删除 ${accountId}/${channelKey}？`);
  if (!ok) return;
  delete account.channels[channelKey];
  await saveChatConfig(config);
  await removeChannelStorage(accountId, channelKey, ctx.cwd);
}

async function configureAccount(ctx: ExtensionContext, accountId: string): Promise<void> {
  while (true) {
    const config = await loadChatConfig();
    const account = config.accounts[accountId];
    if (!account) return;
    const choice = await selectItem(ctx, `${accountId}（${accountDescription(account)}）`, [
      { value: "__add__", label: "添加会话", description: "配置私聊或群聊的目标 ID" },
      ...Object.entries(account.channels).map(([key, channel]) => ({
        value: key,
        label: channel.name || key,
        description: channel.id,
      })),
      { value: "__delete__", label: "删除账号", description: "删除账号和所有会话数据" },
      { value: "__back__", label: "返回" },
    ]);
    if (!choice || choice === "__back__") return;
    if (choice === "__add__") {
      await addChannel(ctx, config, accountId);
    } else if (choice === "__delete__") {
      const ok = await ctx.ui.confirm("删除账号", `删除 ${accountId} 以及所有会话？`);
      if (!ok) continue;
      delete config.accounts[accountId];
      await saveChatConfig(config);
      await removeAccountStorage(accountId, ctx.cwd);
      return;
    } else {
      await configureChannel(ctx, config, accountId, choice);
    }
  }
}

async function createAccount(ctx: ExtensionContext, config: ChatConfig): Promise<string | undefined> {
  const service = (await selectItem(ctx, "选择消息平台", [
    { value: "feishu", label: "飞书", description: "使用飞书开放平台长连接" },
    { value: "wecom", label: "企业微信", description: "使用企业微信智能机器人长连接" },
  ])) as ChatService | undefined;
  if (!service) return undefined;
  const label = (await ctx.ui.input("账号名称", service === "feishu" ? "飞书" : "企业微信"))?.trim();
  if (!label) return undefined;
  const accountId = makeAccountKey(service, label);
  if (service === "feishu") {
    const appId = (await ctx.ui.input("飞书 App ID", "cli_xxx"))?.trim();
    const appSecret = (await ctx.ui.input("飞书 App Secret", "应用凭证"))?.trim();
    if (!appId || !appSecret) return undefined;
    config.accounts[accountId] = {
      service,
      name: label,
      appId,
      appSecret,
      channels: {},
      access: { ignoreBots: true },
    };
  } else {
    const botId = (await ctx.ui.input("企业微信 Bot ID", "智能机器人 ID"))?.trim();
    const secret = (await ctx.ui.input("企业微信 Secret", "智能机器人 Secret"))?.trim();
    if (!botId || !secret) return undefined;
    config.accounts[accountId] = {
      service,
      name: label,
      botId,
      secret,
      channels: {},
      access: { ignoreBots: true },
    };
  }
  await saveChatConfig(config);
  return accountId;
}

export async function runChatConfigUI(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(CHAT_CONFIG_PATH, "info");
    return;
  }
  while (true) {
    const config = await loadChatConfig();
    const choice = await selectItem(ctx, "Agent Inbox 消息平台", [
      ...Object.keys(config.accounts)
        .sort()
        .map((accountId) => ({
          value: accountId,
          label: accountId,
          description: accountDescription(config.accounts[accountId]),
        })),
      { value: "__create__", label: "添加账号", description: "添加飞书或企业微信智能机器人" },
    ]);
    if (!choice) return;
    if (choice === "__create__") {
      const accountId = await createAccount(ctx, config);
      if (accountId) await configureAccount(ctx, accountId);
    } else {
      await configureAccount(ctx, choice);
    }
  }
}
