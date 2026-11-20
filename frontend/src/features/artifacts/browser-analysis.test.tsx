import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { ArtifactMain } from "./ArtifactApp";
import { createArtifactStore } from "./store";
import fixture from "../../../../tests/fixtures/browser-analysis-artifact.json";

afterEach(() => { cleanup(); setLocale("zh-CN"); });

it("reopens the saved browser result with readable source metadata and inert model text", async () => {
  setLocale("en");
  const document = { ...fixture, id: "saved", handle: "artifact:saved", sceneId: "programming",
    summary: "", createdAt: "2026-11-18T06:02:00Z", size: 512, version: "version" };
  const gateway = { get: vi.fn(async () => ({ artifact: document })),
    list: vi.fn(async () => ({ snapshot: { artifacts: [document] } })), importAll: vi.fn(), delete: vi.fn() };
  const store = createArtifactStore({ gateway, getTarget: () => ({ sceneId: "programming", workspaceId: "11111111-1111-4111-8111-111111111111" }) });
  await store.getState().openArtifact("saved");
  const result = render(<ArtifactMain store={store} />);
  expect(screen.getByRole("heading", { name: fixture.title })).toBeTruthy();
  const content = result.container.querySelector(".artifacts-content pre");
  expect(content?.textContent).toBe(fixture.content);
  expect(result.container.querySelector("script")).toBeNull();
  expect(result.container.querySelector(".artifacts-provenance")?.textContent).toContain(fixture.provenance.source.url);
  expect(gateway.get).toHaveBeenCalledWith("programming", "11111111-1111-4111-8111-111111111111", "saved");
  store.getState().destroy();
});
