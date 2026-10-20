import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getLocale, setLocale } from "../../shared/i18n";
import { PluginManagerViewApp } from "./PluginManagerViewApp";

afterEach(cleanup);

it("finds plugins by their localized display name and original name", () => {
  const previousLocale = getLocale();
  setLocale("zh-CN");
  try {
    const { container } = render(
      <PluginManagerViewApp
        registry={{
          list: () => [
            { id: "builtin-ocr", name: "OCR", description: "Image text recognition", enabled: true },
          ],
        }}
      />,
    );
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "文字识别" } });
    expect(container.querySelectorAll(".plugin-manager-card")).toHaveLength(1);
    expect(screen.getByText("文字识别")).toBeTruthy();
    fireEvent.change(search, { target: { value: "OCR" } });
    expect(container.querySelectorAll(".plugin-manager-card")).toHaveLength(1);
  } finally {
    setLocale(previousLocale);
  }
});

it("keeps real manager icons and action identity correct after jumping to a distant page", async () => {
  const plugins = Array.from({ length: 1000 }, (_, i) => ({
    id: `tool-${i}`, name: `Tool ${i}`, description: "", icon: `icon-${i}`, enabled: true,
  }));
  const setEnabled = vi.fn(async () => {});
  const { container } = render(<PluginManagerViewApp registry={{ list: () => plugins, setEnabled }}
    renderIcon={icon => { const node = document.createElement("span"); node.textContent = icon ?? ""; return node; }} />);
  const page = screen.getByRole("spinbutton");
  fireEvent.change(page, { target: { value: "25" } });
  fireEvent.keyDown(page, { key: "Enter" });
  expect(container.querySelectorAll(".plugin-manager-card")).toHaveLength(40);
  expect(screen.getByText("icon-999")).toBeTruthy();
  const last = screen.getByText("tool-999").closest("article");
  if (!last) throw new Error("Last plugin card missing");
  fireEvent.click(within(last).getByRole("button", { name: /Enabled|已启用/ }));
  await waitFor(() => expect(setEnabled).toHaveBeenCalledWith("tool-999", false));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "tool-999" } });
  expect(container.querySelectorAll(".plugin-manager-card")).toHaveLength(1);
  expect(screen.getByText("icon-999")).toBeTruthy();
});
