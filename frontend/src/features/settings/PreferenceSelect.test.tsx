import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PreferenceSelect } from "./PreferenceSelect";

afterEach(cleanup);

const OPTIONS = [
  { value: "night", label: "Graphite Dark" },
  { value: "clean", label: "Bright White" },
  { value: "sage", label: "Sage Light" },
];

function renderSelect(
  props: Partial<Parameters<typeof PreferenceSelect>[0]> = {},
) {
  const onChange = vi.fn();
  const view = render(
    <PreferenceSelect
      id="theme-select"
      value="clean"
      options={OPTIONS}
      label="Theme"
      onChange={onChange}
      {...props}
    />,
  );
  return { view, onChange };
}

describe("PreferenceSelect", () => {
  it("renders the selected option label and listbox attributes", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Theme" });
    expect(trigger.textContent).toContain("Bright White");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
  });

  it("opens the listbox and selects an option by pointer", () => {
    const { onChange } = renderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "Theme" }));
    expect(screen.getByRole("listbox", { name: "Theme" })).toBeTruthy();
    const option = screen.getByRole("option", { name: "Sage Light" });
    expect(option.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("sage");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("marks the current value as selected", () => {
    renderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "Theme" }));
    expect(
      screen.getByRole("option", { name: "Bright White" })?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("selects with ArrowDown and Enter", () => {
    const { onChange } = renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Theme" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    // Start at "clean" (index 1); two ArrowDown moves wrap to "night" (index 0).
    expect(onChange).toHaveBeenCalledWith("night");
  });

  it("closes on Escape without changing the value", () => {
    const { onChange } = renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Theme" });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
