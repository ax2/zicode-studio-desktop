import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QVerisClient } from "./qveris-client";

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function configureKey() {
  const root = mkdtempSync(join(tmpdir(), "zicode-qveris-"));
  roots.push(root);
  writeFileSync(
    join(root, "auth.json"),
    JSON.stringify({ qveris: { type: "api_key", key: "qv-test-secret" } }),
  );
  vi.stubEnv("PI_CODING_AGENT_DIR", root);
  vi.stubEnv("PI_DESKTOP_INSTANCE_ID", "finance-instance");
}

describe("QVeris client", () => {
  it("uses the scene-isolated QVeris credential for compact discovery", async () => {
    configureKey();
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer qv-test-secret" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        query: "historical adjusted equity bars",
        limit: 10,
        view: "routing",
        lang: "zh",
      });
      return new Response(JSON.stringify({ search_id: "srch_test", results: [] }));
    });
    const client = new QVerisClient({ fetchImpl, timeoutMs: 1_000 });

    await expect(
      client.discover({ query: "historical adjusted equity bars", limit: 50 }),
    ).resolves.toMatchObject({ search_id: "srch_test" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://qveris.ai/api/v1/search",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not expose or silently ignore a missing credential", async () => {
    const root = mkdtempSync(join(tmpdir(), "zicode-qveris-empty-"));
    roots.push(root);
    vi.stubEnv("PI_CODING_AGENT_DIR", root);
    const client = new QVerisClient({ fetchImpl: vi.fn() });

    expect(client.credentialStatus()).toMatchObject({ configured: false });
    await expect(client.discover({ query: "stock quote" })).rejects.toThrow(
      "QVeris API Key is not configured",
    );
  });

  it("sanitizes API failures without echoing bearer credentials", async () => {
    configureKey();
    const client = new QVerisClient({
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ error: "Bearer qv-leaked-secret rejected" }), {
          status: 401,
        }),
      ),
    });

    await expect(client.discover({ query: "stock quote" })).rejects.not.toThrow(
      "qv-leaked-secret",
    );
  });

  it("uses authenticated context-safe GET queries for billing audit", async () => {
    configureKey();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: "success", data: { items: [] } })),
    );
    const client = new QVerisClient({ fetchImpl });

    await client.usageAudit({ executionId: "exec_test", limit: 100 });
    await client.creditsLedger({ direction: "consume", limit: 5 });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://qveris.ai/api/v1/auth/usage/history/v2?execution_id=exec_test&summary=true&limit=50",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://qveris.ai/api/v1/auth/credits/ledger?direction=consume&summary=true&limit=5",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
  });

  it("honors a custom base URL for proxied or self-hosted deployments", async () => {
    configureKey();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ search_id: "srch", results: [] })),
    );
    const client = new QVerisClient({
      fetchImpl,
      baseUrl: "https://gateway.example.com/api/v1/",
    });

    await client.discover({ query: "stock quote" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example.com/api/v1/search",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
