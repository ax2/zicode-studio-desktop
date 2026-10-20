import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginManagerViewApp } from "./PluginManagerViewApp";

afterEach(cleanup);

it("reviews a local plugin before installing its exact previewed content", async () => {
  const preview = {
    sourcePath: "C:/candidate",
    contentSha256: "a".repeat(64),
    pluginId: "com.example.inspect",
    name: "Inspect",
    version: "0.1.1",
    publisher: "example",
    permissions: ["pi.tools.register"],
    capabilityCount: 8,
  };
  const selectDeveloperPlugin = vi.fn(async () => preview);
  const installDeveloperPlugin = vi.fn(async () => preview.pluginId);
  const setScene = vi.fn(async () => {});
  render(
    <PluginManagerViewApp
      registry={{ list: () => [], setScene }}
      selectDeveloperPlugin={selectDeveloperPlugin}
      installDeveloperPlugin={installDeveloperPlugin}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Install local plugin|安装本地插件/ }));
  await waitFor(() => expect(screen.getByText(/Inspect · 0\.1\.1 · example/)).toBeTruthy());
  expect(screen.getByText(/pi\.tools\.register/)).toBeTruthy();
  expect(installDeveloperPlugin).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: /Install reviewed plugin|安装已核对插件/ }));
  await waitFor(() =>
    expect(installDeveloperPlugin).toHaveBeenCalledWith(preview.sourcePath, preview.contentSha256),
  );
  await waitFor(() => expect(setScene).toHaveBeenCalled());
  expect(screen.queryByText(/Inspect · 0\.1\.1 · example/)).toBeNull();
});
