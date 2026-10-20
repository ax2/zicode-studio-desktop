import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { SignedPluginPreviewCard } from "./SignedPluginPreviewCard";

describe("SignedPluginPreviewCard", () => {
  it("lets a user inspect and search all tools in a large signed package", () => {
    setLocale("en");
    const onInstall = vi.fn();
    const capabilities = Array.from({ length: 154 }, (_, index) => ({
      id: `tool.${String(index + 1).padStart(3, "0")}`,
      title: `Tool ${index + 1}`,
    }));
    render(
      <SignedPluginPreviewCard
        preview={{
          packagePath: "C:/plugins/candidate.zicode-plugin",
          manifestSha256: "ab".repeat(32),
          pluginId: "com.example.catalog",
          name: "Catalog",
          version: "1.0.0",
          publisher: "Example",
          publisherKeyId: "cd".repeat(32),
          permissions: ["pi.tools.register"],
          capabilityCount: capabilities.length,
          capabilities,
          trusted: false,
        }}
        busy={false}
        onInstall={onInstall}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Declared tools: 154")).toBeTruthy();
    const details = screen.getByText("Tool list").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("Tool list"));
    expect(within(details).getAllByRole("listitem")).toHaveLength(154);
    fireEvent.change(within(details).getByRole("searchbox"), { target: { value: "tool.154" } });
    expect(within(details).getAllByRole("listitem")).toHaveLength(1);
    expect(within(details).getByText("Tool 154")).toBeTruthy();
    expect(within(details).getByText("1 / 154")).toBeTruthy();
    expect(onInstall).not.toHaveBeenCalled();
  });
});
