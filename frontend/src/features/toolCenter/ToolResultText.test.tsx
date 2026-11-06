import { act } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent, screen } from "@testing-library/dom";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolResultView } from "./ManualToolResultView";
import { resultTextFields } from "./tool-result-text";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
function mockCopy(copy = vi.fn(async (_text: string) => {})) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  return copy;
}
async function show(text: string) {
  if (!root) root = createRoot(document.body.appendChild(document.createElement("div")));
  setLocale("en");
  await act(async () => root.render(<ManualToolResultView result={{ successful: true, text, raw: `envelope:${text}` }} />));
}
afterEach(() => { root = undefined as unknown as ReturnType<typeof createRoot>; });

it("copies exact complete result and explicitly selected multiline text without changing numeric JSON", async () => {
  const copy = mockCopy();
  const text = '{"id":9007199254740993,"text":"id,name\\r\\n1,中\\r\\n","empty":""}';
  await show(text);
  await act(async () => fireEvent.click(screen.getByText("Copy displayed text")));
  expect(copy).toHaveBeenLastCalledWith(text);
  await act(async () => fireEvent.change(screen.getByRole("combobox"), { target: { value: "0" } }));
  expect((screen.getByLabelText("Tool result") as HTMLTextAreaElement).value).toBe("id,name\n1,中\n");
  await act(async () => fireEvent.click(screen.getByText("Copy displayed text")));
  expect(copy).toHaveBeenLastCalledWith("id,name\r\n1,中\r\n");
  expect((screen.getByLabelText("Original response") as HTMLTextAreaElement).value).toBe(`envelope:${text}`);
  await act(async () => fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } }));
  await act(async () => fireEvent.click(screen.getByText("Copy displayed text")));
  expect(copy).toHaveBeenLastCalledWith("");
});

it("falls back to focused selected text when clipboard permission is denied", async () => {
  mockCopy(vi.fn(async () => { throw new Error("denied"); }));
  await show("中\nvalue");
  await act(async () => fireEvent.click(screen.getByText("Copy displayed text")));
  const textarea = screen.getByLabelText("Tool result") as HTMLTextAreaElement;
  expect(document.activeElement).toBe(textarea);
  expect(textarea.selectionStart).toBe(0);
  expect(textarea.selectionEnd).toBe(textarea.value.length);
  expect(screen.getByText("Copy failed. Text selected; use your system copy shortcut.")).toBeTruthy();
});

it("resets field view and ignores a late clipboard failure after a new result", async () => {
  let reject: (error: Error) => void = () => {};
  mockCopy(vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; })));
  await show('{"text":"old"}');
  await act(async () => fireEvent.change(screen.getByRole("combobox"), { target: { value: "0" } }));
  await act(async () => fireEvent.click(screen.getByText("Copy displayed text")));
  await show('{"text":"new"}');
  await act(async () => reject(new Error("late")));
  expect((screen.getByLabelText("Tool result") as HTMLTextAreaElement).value).toBe('{"text":"new"}');
  expect(screen.queryByText("Copy failed. Text selected; use your system copy shortcut.")).toBeNull();
  expect(screen.getByText("Copy displayed text").hasAttribute("disabled")).toBe(false);
});

it("treats markup as inert text and bounds optional field discovery", async () => {
  const text = '{"<img src=x onerror=alert(1)>":"<script>bad()</script>","nested":{"text":"hidden"}}';
  await show(text);
  await act(async () => fireEvent.change(screen.getByRole("combobox"), { target: { value: "0" } }));
  expect(document.querySelector("img,script")).toBeNull();
  expect(resultTextFields(text)).toHaveLength(1);
  for (const invalid of ["plain", "[1,2]", "null", "42", '{"text":"broken', ' '.repeat(1024 * 1024 + 1)]) {
    expect(resultTextFields(invalid)).toEqual([]);
  }
  expect(resultTextFields(JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, "value"]))))).toHaveLength(16);
});
