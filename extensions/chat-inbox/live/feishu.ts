import { createLarkChannel } from "@larksuiteoapi/node-sdk";

import type { FeishuAccountConfig, ResolvedConversation } from "../core/config-types.js";
import { chunkText } from "../render/chunking.js";
import { formatMarkdownForService, maxMessageLength } from "../render/format.js";
import type { LiveConnection, LiveConnectionHandlers, ResumeState } from "./types.js";

export async function connectFeishuLive(
  conversation: ResolvedConversation,
  handlers: LiveConnectionHandlers,
  _resumeState?: ResumeState,
): Promise<LiveConnection> {
  const account = conversation.account as FeishuAccountConfig;
  const channel = createLarkChannel({
    appId: account.appId,
    appSecret: account.appSecret,
    transport: "websocket",
    source: "zicode-studio-desktop",
  });
  let replyTo: string | undefined;
  let previewMessageId: string | undefined;

  channel.on("message", async (message) => {
    if (message.chatId !== conversation.channel.id) return;
    const allowed = conversation.access.allowedUserIds;
    if (allowed?.length && !allowed.includes(message.senderId)) return;
    await handlers.onMessage(
      {
        messageId: message.messageId,
        userId: message.senderId,
        userName: message.senderName,
        text: message.content,
        isBot: false,
      },
      { messageId: message.messageId },
    );
  });
  channel.on("error", (error) => {
    void handlers.onError(error);
  });

  await channel.connect();
  await handlers.onCaughtUp();

  const sendText = async (text: string, replyToMessageId?: string): Promise<string | undefined> => {
    const rendered = formatMarkdownForService("feishu", text);
    let firstId: string | undefined;
    for (const part of chunkText(rendered.text, maxMessageLength("feishu"))) {
      const result = await channel.send(
        conversation.channel.id,
        { markdown: part },
        { replyTo: replyToMessageId ?? replyTo },
      );
      firstId ??= result.messageId;
    }
    return firstId;
  };

  return {
    conversation,
    async disconnect() {
      await channel.disconnect();
      await handlers.onDisconnect?.();
    },
    sendImmediate: sendText,
    async send(text, attachmentPaths, _signal, replyToMessageId) {
      const messageId = await sendText(text, replyToMessageId);
      for (const attachmentPath of attachmentPaths ?? []) {
        await channel.send(conversation.channel.id, {
          file: { source: attachmentPath, fileName: attachmentPath.split(/[\\/]/).pop() || "file" },
        });
      }
      return messageId;
    },
    async startTyping() {},
    async stopTyping() {},
    async syncPreview(markdown, done = false) {
      if (!markdown.trim()) return [];
      if (previewMessageId) {
        await channel.editMessage(previewMessageId, markdown);
      } else {
        previewMessageId = await sendText(markdown);
      }
      if (done) previewMessageId = undefined;
      return previewMessageId ? [previewMessageId] : [];
    },
    async clearPreview() {
      if (previewMessageId) await channel.recallMessage(previewMessageId);
      previewMessageId = undefined;
    },
    setReplyTo(messageId) {
      replyTo = messageId;
    },
  };
}
