import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManualToolResultView } from "./ManualToolResultView";
import { inlineToolImage } from "./inline-tool-image";
import { decodeResourceImage } from "../../../../public/native/plugins/plugin-resource-image.js";
import { setLocale } from "../../shared/i18n";

vi.mock("../../../../public/native/plugins/plugin-resource-image.js", async importOriginal => ({
  ...await importOriginal<object>(), decodeResourceImage: vi.fn(),
}));
function png(width = 2, height = 3) {
  const bytes = new Uint8Array(57), view = new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10]); view.setUint32(8,13); bytes.set(new TextEncoder().encode("IHDR"),12);
  view.setUint32(16,width); view.setUint32(20,height); bytes.set(new TextEncoder().encode("IDAT"),37); bytes.set(new TextEncoder().encode("IEND"),49);
  return bytes;
}
const encode = (bytes = png()) => JSON.stringify({ dataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`, width: 2, height: 3, mimeType: "image/png" });
const outcome = (text = encode()) => ({ successful: true, text, raw: `original:${text}` });
const create = vi.fn(), revoke = vi.fn();
beforeEach(() => {
  setLocale("en"); let id = 0; create.mockReset().mockImplementation(() => `blob:preview-${++id}`); revoke.mockReset();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  vi.mocked(decodeResourceImage).mockReset().mockResolvedValue({ kind: "image", width: 2, height: 3, blob: new Blob(["rendered"], { type: "image/png" }) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("validates bounded inline PNG containers without following remote or active content", () => {
  const parsed = inlineToolImage(encode());
  expect(parsed).toMatchObject({ width: 2, height: 3, mimeType: "image/png" }); expect(parsed?.bytes).toEqual(png());
  for (const text of ['plain', JSON.stringify({dataUrl:"https://example.test/image.png"}), JSON.stringify({dataUrl:"data:image/svg+xml;base64,PHN2Zy8+"}),
    encode().replace('image/png','text/html'), encode().replace('"width":2','"width":9'), encode(png(4097,3)), encode(png(4096,4096)), ' '.repeat(1024*1024+1)]) {
    expect(inlineToolImage(text)).toBeNull();
  }
  for (const tag of ["acTL","fcTL","fdAT"]) { const animated=png(); animated.set(new TextEncoder().encode(tag),37);expect(inlineToolImage(encode(animated))).toBeNull(); }
});

it("previews decoded pixels and downloads the unchanged original only through an explicit link", async () => {
  const text = encode(); const view = render(<ManualToolResultView result={outcome(text)} />);
  await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toBe("blob:preview-1"));
  const link = screen.getByRole("link", { name: "Download PNG" });
  expect(link.getAttribute("download")).toBe("tool-result.png"); expect(link.getAttribute("href")).toBe("blob:preview-2");
  const original = create.mock.calls[1][0] as Blob;
  const downloaded = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(original);
  });
  expect(new Uint8Array(downloaded)).toEqual(png());
  expect((screen.getByLabelText("Tool result") as HTMLTextAreaElement).value).toBe(text);
  expect(view.container.querySelector(".tool-image-encoded-output")?.hasAttribute("open")).toBe(false);
  fireEvent.click(screen.getByText("View image encoding"));
  expect((screen.getByLabelText("Original response") as HTMLTextAreaElement).value).toBe(`original:${text}`);
  view.unmount(); expect(revoke.mock.calls.map(call => call[0]).sort()).toEqual(["blob:preview-1", "blob:preview-2"]);
});

it("falls back to exact readable output when decoding fails and never offers a broken download", async () => {
  vi.mocked(decodeResourceImage).mockRejectedValue(Error("invalid PNG"));
  const view = render(<ManualToolResultView result={outcome()} />);
  await waitFor(() => expect(view.container.querySelector(".tool-image-encoded-output")?.hasAttribute("open")).toBe(true));
  expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByRole("link", { name: "Download PNG" })).toBeNull();
  expect((screen.getByLabelText("Tool result") as HTMLTextAreaElement).value).toBe(encode());
});

it("ignores a late decoder after a newer text result replaces the image", async () => {
  let finish!: (value: Awaited<ReturnType<typeof decodeResourceImage>>) => void;
  vi.mocked(decodeResourceImage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ManualToolResultView result={outcome()} />);
  view.rerender(<ManualToolResultView result={outcome("new result")} />);
  await act(async () => finish({ kind: "image", width: 2, height: 3, blob: new Blob(["late"]) }));
  expect(create).not.toHaveBeenCalled(); expect(screen.queryByRole("img")).toBeNull();
  expect((screen.getByLabelText("Tool result") as HTMLTextAreaElement).value).toBe("new result");
});

it("never presents an image from a failed tool result", () => {
  render(<ManualToolResultView result={{ ...outcome(), successful: false, errorCode: "FAILED" }} />);
  expect(screen.queryByRole("img")).toBeNull(); expect(vi.mocked(decodeResourceImage)).not.toHaveBeenCalled();
});

it("exposes the exact encoded output if the image element cannot load", async () => {
  const view = render(<ManualToolResultView result={outcome()} />);
  const image = await screen.findByRole("img"); fireEvent.error(image);
  expect(screen.queryByRole("link", { name: "Download PNG" })).toBeNull();
  expect(view.container.querySelector(".tool-image-encoded-output")?.hasAttribute("open")).toBe(true);
  expect((screen.getByLabelText("Tool result") as HTMLTextAreaElement).value).toBe(encode());
});
