// @vitest-environment node

import { describe, expect, it } from "vitest";
import { listConfiguredConversations } from "./chat-inbox/config.ts";
import type { ChatConfig } from "./chat-inbox/core/config-types.ts";

describe("pi-chat configured conversations", () => {
  it("only exposes DM conversations", () => {
    const config: ChatConfig = {
      accounts: {
        feishu: {
          service: "feishu",
          appId: "cli_test",
          appSecret: "test-secret",
          channels: {
            dm: { id: "100", dm: true },
            group: { id: "-100", dm: false },
          },
        },
      },
    };

    expect(
      listConfiguredConversations(config).map((conversation) => conversation.channelKey),
    ).toEqual(["dm"]);
  });
});
