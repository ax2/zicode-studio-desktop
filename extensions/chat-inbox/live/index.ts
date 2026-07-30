import type { ResolvedConversation } from "../core/config-types.js";
import { connectFeishuLive } from "./feishu.js";
import type { LiveConnection, LiveConnectionHandlers, ResumeState } from "./types.js";
import { connectWeComLive } from "./wecom.js";

export async function connectLive(
  conversation: ResolvedConversation,
  handlers: LiveConnectionHandlers,
  resumeState?: ResumeState,
): Promise<LiveConnection> {
  if (conversation.service === "feishu") {
    return connectFeishuLive(conversation, handlers, resumeState);
  }
  if (conversation.service === "wecom") {
    return connectWeComLive(conversation, handlers, resumeState);
  }
  throw new Error(`Unsupported chat service: ${String(conversation.service)}`);
}
