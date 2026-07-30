export type ChatService = "feishu" | "wecom";

export interface AccessPolicy {
  ignoreBots?: boolean;
  allowedUserIds?: string[];
}

export interface ConfiguredChannel {
  id: string;
  name?: string;
  dm?: boolean;
  access?: AccessPolicy;
}

export interface BaseAccountConfig {
  service: ChatService;
  name?: string;
  access?: AccessPolicy;
  channels: Record<string, ConfiguredChannel>;
}

export interface FeishuAccountConfig extends BaseAccountConfig {
  service: "feishu";
  appId: string;
  appSecret: string;
}

export interface WeComAccountConfig extends BaseAccountConfig {
  service: "wecom";
  botId: string;
  secret: string;
}

export type ChatAccountConfig = FeishuAccountConfig | WeComAccountConfig;

export interface ChatConfig {
  botName?: string;
  accounts: Record<string, ChatAccountConfig>;
}

export interface ResolvedConversation {
  service: ChatService;
  botName: string;
  accountId: string;
  account: ChatAccountConfig;
  channelKey: string;
  channel: ConfiguredChannel;
  conversationId: string;
  conversationName: string;
  access: AccessPolicy;
  accountDir: string;
  sharedDir: string;
  conversationDir: string;
  workspaceDir: string;
  accountMemoryPath: string;
  channelMemoryPath: string;
  logPath: string;
  filesDir: string;
  lockPath: string;
}
