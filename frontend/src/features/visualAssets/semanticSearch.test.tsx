import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SemanticSearch } from "./SemanticSearch";

vi.mock("../../shared/i18n", () => ({ t: (s: string) => s }));
afterEach(cleanup);
it("opens the second same-name result by stable ID, including long names", async () => {
  const name = "长文件名".repeat(30) + ".png";
  const invoke = vi.fn(async (_command: string, { request: r }) => {
    if (r.kind === "queryModel" && r.action.kind === "catalog")
      return {
        models: [{ provider: "local", model: "m", name: "Model", endpoint: "http://localhost" }],
      };
    if (r.kind === "queryModel") return { concepts: ["费用"] };
    if (r.kind === "searchConcepts")
      return {
        matches: [
          { id: 4, name, matched: ["费用"] },
          { id: 8, name, matched: ["费用"] },
        ],
      };
    if (r.kind === "preview") return { handle: "eight" };
    return { mimeType: "image/png", base64: "aW1hZ2U=" };
  });
  render(<SemanticSearch invoke={invoke} workspaceId="w" sceneId="s" libraryId="l" />);
  fireEvent.click(screen.getByText("Semantic search"));
  fireEvent.click(screen.getByText("Load search models"));
  fireEvent.change(await screen.findByLabelText("Search model"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Search phrase"), { target: { value: "开销" } });
  fireEvent.click(screen.getByText("Review model search"));
  fireEvent.click((await screen.findAllByRole("button", { name }))[1]);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
      workspaceId: "w",
      request: { kind: "preview", libraryId: "l", assetId: 8, revision: 1 },
    }),
  );
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "w",
    request: {
      kind: "queryModel",
      sceneId: "s",
      action: { kind: "expand", query: "开销", provider: "local", model: "m" },
    },
  });
});

it("opens the same review on Enter release and ignores an IME confirmation", async () => {
  let cancelReview: (() => void) | undefined;
  const invoke = vi.fn(async (_command: string, { request }) => {
    if (request.kind !== "queryModel") throw Error("Unexpected local search");
    if (request.action.kind === "catalog") return {
      models: [{ provider: "fixture", model: "mock", name: "Fixture", endpoint: "https://unused.invalid" }],
    };
    return new Promise(resolve => { cancelReview = () => resolve({ cancelled: true }); });
  });
  render(<SemanticSearch invoke={invoke} workspaceId="w" sceneId="s" libraryId="l" />);
  fireEvent.click(screen.getByText("Semantic search"));
  const input = screen.getByLabelText("Search phrase");
  const review = screen.getByRole("button", { name: "Review model search" });
  const down = (options = {}) => fireEvent.keyDown(input, { key: "Enter", ...options });
  const up = () => fireEvent.keyUp(input, { key: "Enter" });
  down(); up();
  expect(invoke).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText("Load search models"));
  fireEvent.change(await screen.findByLabelText("Search model"), { target: { value: "0" } });
  fireEvent.change(input, { target: { value: "开销" } });
  fireEvent.compositionStart(input); down(); fireEvent.compositionEnd(input); up();
  down({ keyCode: 229 }); up();
  down({ ctrlKey: true }); up();
  down(); fireEvent.blur(input); up();
  expect(invoke).toHaveBeenCalledTimes(1);

  down(); down({ repeat: true });
  expect(invoke).toHaveBeenCalledTimes(1);
  up();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenLastCalledWith("visual_assets_control", {
    workspaceId: "w",
    request: { kind: "queryModel", sceneId: "s", action: { kind: "expand", query: "开销", provider: "fixture", model: "mock" } },
  });
  expect(review.matches(":disabled")).toBe(true);
  await act(async () => cancelReview?.());
  expect(review.matches(":disabled")).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(2);
});
