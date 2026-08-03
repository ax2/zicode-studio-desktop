// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  fetchQVerisModelCatalog,
  QVERIS_MODEL_GATEWAY_BASE_URL,
} from "./qveris-model-gateway";

describe("QVeris model gateway catalog", () => {
  it("maps chat models and omits embedding-only entries", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "vision-reasoner",
              context_window: 262144,
              capabilities: ["chat", "tools", "vision", "reasoning"],
              pricing: {
                prompt_usd_per_million_tokens: 3,
                completion_usd_per_million_tokens: 15,
                cached_input_usd_per_million_tokens: 0.3,
                tiers: [
                  {
                    min_input_tokens: 200001,
                    prompt_usd_per_million: 6,
                    completion_usd_per_million: 22.5,
                    cached_usd_per_million: 0.6,
                  },
                ],
              },
            },
            {
              id: "embedding-only",
              context_window: 8192,
              capabilities: ["embeddings"],
            },
          ],
        }),
    })) as unknown as typeof fetch;

    await expect(fetchQVerisModelCatalog("secret", { fetchImpl })).resolves.toEqual([
      {
        id: "vision-reasoner",
        name: "vision-reasoner",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 262144,
        cost: {
          input: 3,
          output: 15,
          cacheRead: 0.3,
          cacheWrite: 0,
          tiers: [
            {
              inputTokensAbove: 200000,
              input: 6,
              output: 22.5,
              cacheRead: 0.6,
              cacheWrite: 0,
            },
          ],
        },
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${QVERIS_MODEL_GATEWAY_BASE_URL}/models`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });

  it("does not expose credentials in gateway errors", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => JSON.stringify({ error: { message: "invalid_api_key" } }),
    })) as unknown as typeof fetch;

    await expect(
      fetchQVerisModelCatalog("super-secret", { fetchImpl }),
    ).rejects.toThrow("invalid_api_key");
    await expect(
      fetchQVerisModelCatalog("super-secret", { fetchImpl }),
    ).rejects.not.toThrow("super-secret");
  });

  it("uses an editable gateway base URL and the documented models endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ object: "list", data: [] }),
    })) as unknown as typeof fetch;

    await fetchQVerisModelCatalog("secret", {
      fetchImpl,
      baseUrl: "http://gateway.internal:8080/v1/",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://gateway.internal:8080/v1/models",
      expect.any(Object),
    );
  });
});
