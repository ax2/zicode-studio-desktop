import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

afterEach(cleanup);

const OPTIONS = [
  { value: "night", label: "Graphite Dark" },
  { value: "clean", label: "Bright White" },
  { value: "sage", label: "Sage Light" },
];

function renderSelect(
  props: Partial<Parameters<typeof Select>[0]> = {},
) {
  const onChange = vi.fn();
  render(
    <Select
      id="theme-select"
      value="clean"
      options={OPTIONS}
      label="Theme"
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

describe("Select", () => {
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
      screen
        .getByRole("option", { name: "Bright White" })
        ?.getAttribute("aria-selected"),
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

  it("applies the wrapper class to the root element", () => {
    renderSelect({ className: "settings-preference-select" });
    expect(
      document.querySelector(".app-select.settings-preference-select"),
    ).toBeTruthy();
  });
});
