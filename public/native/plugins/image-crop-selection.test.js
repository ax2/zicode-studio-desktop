import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createImageCropSelection } from "./image-crop-selection.js";
import { loadResourcePreview } from "./plugin-resource-preview-load.js";

vi.mock("./plugin-resource-preview-load.js", () => ({ loadResourcePreview: vi.fn(), resourceImagePreviewLimit: 8 * 1024 * 1024 }));
const png = { mimeType: "image/png", byteLength: 180 };
const decoded = { kind: "image", blob: new Blob(), width: 8, height: 4 };

const controls = [];
afterEach(() => {
  for (const controller of controls.splice(0)) controller.destroy();
  document.body.replaceChildren();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  setLocale("en");
  class ObjectUrl extends URL {
    static createObjectURL = vi.fn(() => "blob:crop");
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", ObjectUrl);
  const first = { resourceId: "first", contentVersion: "a".repeat(64) };
  let current = first;
  const read = vi.fn(async () => ({}));
  const onApply = vi.fn();
  const controller = createImageCropSelection({ container: document.body, read, isCurrent: value => value === current, onApply });
  controls.push(controller);
  return {
    controller, first, read, onApply, ObjectUrl,
    replace(resource, metadata) { current = resource; controller.show(resource, metadata); },
    revoke() { current = undefined; },
  };
}

function pointer(image, type, clientX, clientY) {
  const event = new MouseEvent(type, { clientX, clientY, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  image.dispatchEvent(event);
}

it("shows only an approved PNG and explicitly applies its clamped native pixel bounds", async () => {
  const f = setup();
  expect(document.querySelector("section").hidden).toBe(true);
  f.controller.show(f.first, { ...png, mimeType: "image/jpeg" });
  expect(document.querySelector("section").hidden).toBe(true);
  loadResourcePreview.mockResolvedValue(decoded);
  f.controller.show(f.first, png);
  expect(f.read).not.toHaveBeenCalled();
  const preview = getByRole(document.body, "button", { name: "Preview crop source" });
  fireEvent.click(preview);
  await waitFor(() => expect(getByRole(document.body, "img")).toBeTruthy());
  const image = getByRole(document.body, "img");
  Object.defineProperty(image, "complete", { value: true });
  Object.defineProperty(image, "naturalWidth", { value: 8 });
  image.setPointerCapture = vi.fn();
  image.getBoundingClientRect = () => ({ left: 20, top: 20, width: 200, height: 100 });
  pointer(image, "pointerdown", 170, 95);
  pointer(image, "pointerup", 16, 45);
  expect(f.onApply).not.toHaveBeenCalled();
  fireEvent.click(getByRole(document.body, "button", { name: "Apply crop area" }));
  await waitFor(() => expect(f.onApply).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 1, width: 6, height: 2 }));
  expect(f.read).toHaveBeenCalledExactlyOnceWith(f.first, 0, 1, expect.any(Function));
  f.controller.show(null);
  expect(f.ObjectUrl.revokeObjectURL).toHaveBeenCalledWith("blob:crop");
});

it("ignores a late preview for the file replaced during loading", async () => {
  const f = setup();
  let ready;
  loadResourcePreview.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
  f.controller.show(f.first, png);
  fireEvent.click(getByRole(document.body, "button", { name: "Preview crop source" }));
  f.replace({ resourceId: "replacement", contentVersion: "b".repeat(64) }, png);
  ready(decoded);
  await Promise.resolve();
  expect(f.ObjectUrl.createObjectURL).not.toHaveBeenCalled();
  expect(getByRole(document.body, "button", { name: "Preview crop source" }).disabled).toBe(false);
  expect(f.onApply).not.toHaveBeenCalled();
});

async function selectedArea(f) {
  loadResourcePreview.mockResolvedValue({ ...decoded, width: 40, height: 30 });
  f.controller.show(f.first, png);
  fireEvent.click(getByRole(document.body, "button", { name: "Preview crop source" }));
  await waitFor(() => expect(getByRole(document.body, "img")).toBeTruthy());
  const image = getByRole(document.body, "img");
  Object.defineProperty(image, "complete", { value: true });
  Object.defineProperty(image, "naturalWidth", { value: 40 });
  image.setPointerCapture = vi.fn();
  image.getBoundingClientRect = () => ({ left: 20, top: 20, width: 400, height: 300 });
  pointer(image, "pointerdown", 120, 100);
  pointer(image, "pointerup", 240, 200);
  return getByRole(document.body, "group", { name: "Crop area" });
}

function press(target, key, modifiers = {}) {
  return target.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...modifiers }));
}

it("moves the existing crop in native pixels, clamps all four edges, and still requires explicit Apply", async () => {
  const f = setup();
  const stage = await selectedArea(f);
  expect(stage.tabIndex).toBe(0);
  stage.focus();
  const status = document.getElementById(stage.getAttribute("aria-describedby"));
  expect(status.getAttribute("role")).toBe("status");
  expect(status.textContent).toContain("Left 10, top 8, width 12, height 10 pixels.");
  expect(press(stage, "ArrowRight")).toBe(false);
  expect(press(stage, "ArrowUp")).toBe(false);
  expect(status.textContent).toContain("Left 11, top 7, width 12, height 10 pixels.");
  for (const key of ["ArrowRight", "ArrowDown"]) press(stage, key, { shiftKey: true });
  expect(status.textContent).toContain("Left 21, top 17, width 12, height 10 pixels.");
  for (const key of ["ArrowRight", "ArrowDown"]) press(stage, key, { shiftKey: true });
  expect(status.textContent).toContain("Left 28, top 20, width 12, height 10 pixels.");
  for (const key of ["ArrowLeft", "ArrowUp", "ArrowLeft", "ArrowUp", "ArrowLeft", "ArrowUp"]) {
    press(stage, key, { shiftKey: true });
  }
  expect(status.textContent).toContain("Left 0, top 0, width 12, height 10 pixels.");
  expect(f.read).not.toHaveBeenCalled();
  expect(f.onApply).not.toHaveBeenCalled();
  fireEvent.click(getByRole(document.body, "button", { name: "Apply crop area" }));
  await waitFor(() => expect(f.onApply).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 0, width: 12, height: 10 }));
  expect(f.read).toHaveBeenCalledExactlyOnceWith(f.first, 0, 1, expect.any(Function));
});

it("leaves keys alone during input, dialogs, Apply, disable and revocation", async () => {
  const f = setup();
  const stage = await selectedArea(f);
  const outline = stage.querySelector(".image-crop-outline");
  const left = outline.style.left;
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  expect(press(input, "ArrowRight")).toBe(true);
  expect(press(stage, "ArrowRight")).toBe(true);
  stage.focus();
  for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
    expect(press(stage, "ArrowRight", modifiers)).toBe(true);
  }
  const dialog = document.createElement("dialog");
  dialog.open = true;
  document.body.append(dialog);
  expect(press(stage, "ArrowRight")).toBe(true);
  dialog.remove();
  f.controller.setDisabled(true);
  expect(stage.tabIndex).toBe(-1);
  expect(press(stage, "ArrowRight")).toBe(true);
  f.controller.setDisabled(false);
  let settle;
  f.read.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  fireEvent.click(getByRole(document.body, "button", { name: "Apply crop area" }));
  expect(press(stage, "ArrowRight")).toBe(true);
  f.revoke();
  settle({});
  await Promise.resolve();
  expect(press(stage, "ArrowRight")).toBe(true);
  expect(outline.style.left).toBe(left);
  expect(f.onApply).not.toHaveBeenCalled();
});
