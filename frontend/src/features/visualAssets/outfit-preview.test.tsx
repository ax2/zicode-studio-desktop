import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OutfitImagePreview } from "./OutfitImagePreview";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);
const png = { mimeType: "image/png", base64: "aW1hZ2U=" };
it("keeps pending local reads distinct from a failed preview", async () => {
  let resolve!: (value: unknown) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue(png);
  render(<OutfitImagePreview request={request} libraryId="lib" assetId={1} label="Original" />);
  expect(screen.queryByText("Preview unavailable")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("Loading...");
  resolve({ handle: "first" });
  const img = await screen.findByRole("img", { name: "Original" });
  fireEvent.load(img);
  expect(screen.queryByText("Loading...")).toBeNull();
});
it("retries only local preview reads with a fresh ticket after failure", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ handle: "old" })
    .mockRejectedValueOnce("visual_assets_busy")
    .mockResolvedValueOnce({ handle: "new" })
    .mockResolvedValueOnce(png);
  render(<OutfitImagePreview request={request} libraryId="lib" assetId={7} label="Original" />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again · Original" }));
  const img = await screen.findByRole("img");
  fireEvent.load(img);
  expect(request.mock.calls).toEqual([
    [{ kind: "preview", libraryId: "lib", assetId: 7, revision: 1 }],
    [{ kind: "readPreview", handle: "old" }],
    [{ kind: "preview", libraryId: "lib", assetId: 7, revision: 1 }],
    [{ kind: "readPreview", handle: "new" }],
  ]);
  expect(screen.queryByText("Preview unavailable")).toBeNull();
});
it("permits retry after browser image decoding fails without generation", async () => {
  const request = vi.fn(async (r: Record<string, unknown>) =>
    r.kind === "preview" ? { handle: "h" } : png,
  );
  render(<OutfitImagePreview request={request} libraryId="lib" assetId={7} label="Result" />);
  fireEvent.error(await screen.findByRole("img"));
  fireEvent.click(await screen.findByRole("button", { name: "Try again · Result" }));
  fireEvent.load(await screen.findByRole("img"));
  expect(request.mock.calls.map((c) => c[0].kind)).toEqual([
    "preview",
    "readPreview",
    "preview",
    "readPreview",
  ]);
});
it("ignores old asset responses after the reference changes", async () => {
  let resolve!: (value: unknown) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce({ handle: "new" })
    .mockResolvedValueOnce(png);
  const view = render(
    <OutfitImagePreview request={request} libraryId="lib" assetId={1} label="Original" />,
  );
  view.rerender(
    <OutfitImagePreview request={request} libraryId="lib" assetId={2} label="Original" />,
  );
  fireEvent.load(await screen.findByRole("img"));
  resolve({ handle: "stale" });
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(request.mock.calls.some((c) => c[0].handle === "stale")).toBe(false);
});
it.each([
  { mimeType: "image/jpeg", base64: "x" },
  { mimeType: "image/png", base64: "" },
  { mimeType: "image/png", base64: "x".repeat(700001) },
])("rejects invalid preview data with an explicit recovery button", async (data) => {
  const request = vi.fn().mockResolvedValueOnce({ handle: "h" }).mockResolvedValueOnce(data);
  render(<OutfitImagePreview request={request} libraryId="lib" assetId={1} label="Original" />);
  expect(await screen.findByRole("button", { name: "Try again · Original" })).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
});
