import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { WSClient } from "@wecom/aibot-node-sdk";

import type { ResolvedConversation, WeComAccountConfig } from "../core/config-types.js";
import { chunkText } from "../render/chunking.js";
import { formatMarkdownForService, maxMessageLength } from "../render/format.js";
import type { LiveConnection, LiveConnectionHandlers, ResumeState } from "./types.js";

export async function connectWeComLive(
  conversation: ResolvedConversation,
  handlers: LiveConnectionHandlers,
  _resumeState?: ResumeState,
): Promise<LiveConnection> {
  const account = conversation.account as WeComAccountConfig;
  const client = new WSClient({ botId: account.botId, secret: account.secret });

  client.on("message.text", (frame) => {
    const message = frame.body;
    if (!message) return;
    const targetId = message.chattype === "group" ? message.chatid : message.from.userid;
    if (targetId !== conversation.channel.id) return;
    const allowed = conversation.access.allowedUserIds;
    if (allowed?.length && !allowed.includes(message.from.userid)) return;
    void handlers.onMessage(
      {
        messageId: message.msgid,
        userId: message.from.userid,
        text: message.text.content,
        isBot: false,
      },
      { messageId: message.msgid },
    );
  });
  client.on("error", (error) => void handlers.onError(error));
  client.on("disconnected", () => void handlers.onDisconnect?.());
  client.connect();

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("企业微信连接超时")), 15_000);
    client.once("authenticated", () => {
      clearTimeout(timeout);
      resolve();
    });
    client.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  await handlers.onCaughtUp();

  const sendText = async (text: string): Promise<string | undefined> => {
    const rendered = formatMarkdownForService("wecom", text);
    const messageId = randomUUID();
    for (const part of chunkText(rendered.text, maxMessageLength("wecom"))) {
      await client.sendMessage(conversation.channel.id, {
        msgtype: "markdown",
        markdown: { content: part },
      });
    }
    return messageId;
  };

  return {
    conversation,
    async disconnect() {
      client.disconnect();
    },
    sendImmediate: sendText,
    async send(text, attachmentPaths) {
      const messageId = await sendText(text);
      for (const attachmentPath of attachmentPaths ?? []) {
        const upload = await client.uploadMedia(await readFile(attachmentPath), {
          type: "file",
          filename: attachmentPath.split(/[\\/]/).pop() || "file",
        });
        await client.sendMediaMessage(conversation.channel.id, "file", upload.media_id);
      }
      return messageId;
    },
    async startTyping() {},
    async stopTyping() {},
    async syncPreview() {
      return [];
    },
    async clearPreview() {},
    setReplyTo() {},
  };
}
