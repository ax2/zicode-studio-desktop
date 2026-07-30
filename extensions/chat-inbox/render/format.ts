import type { ChatService } from "../core/config-types.js";

export interface RenderedChunkPayload {
  text: string;
  parseMode?: "Markdown";
}

export function formatMarkdownForService(
  _service: ChatService,
  markdown: string,
): RenderedChunkPayload {
  return { text: markdown };
}

export function maxMessageLength(_service: ChatService): number {
  return 4000;
}
