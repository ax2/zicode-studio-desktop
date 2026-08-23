// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeFileBrowser } from "../react/file-browser.js";

class DataTransferStub {
  constructor() {
    this.data = new Map();
  }

  setData(type, value) {
    this.data.set(type, String(value));
  }

  getData(type) {
    return this.data.get(type) ?? "";
  }

  get types() {
    return Array.from(this.data.keys());
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeGateway(handler) {
  return { listFiles: handler };
}

describe("NativeFileBrowser", () => {
  let container;
  let pathEl;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    pathEl = document.createElement("div");
    document.body.append(container, pathEl);
  });

  it("lists workspace-relative entries scoped through the data gateway", async () => {
    const gateway = fakeGateway(async (workspaceId, path) => {
      expect(workspaceId).toBe("workspace-a");
      expect(path).toBe("");
      return { entries: [{ name: "src", relativePath: "src", kind: "directory" }] };
    });
    const browser = new NativeFileBrowser(container, pathEl, gateway, "workspace-a");

    await browser.load();

    expect(container.textContent).toContain("src");
    expect(browser.currentPath).toBe("");
    expect(browser.getParentPath()).toBeNull();
  });

  it("navigates into a directory and computes its parent path", async () => {
    const gateway = fakeGateway(async (_workspaceId, path) => {
      if (path === "")
        return { entries: [{ name: "src", relativePath: "src", kind: "directory" }] };
      return { entries: [{ name: "app.js", relativePath: "src/app.js", kind: "file" }] };
    });
    const browser = new NativeFileBrowser(container, pathEl, gateway, "workspace-a");
    await browser.load();

    container.querySelector(".file-item").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(browser.currentPath).toBe("src");
    expect(browser.getParentPath()).toBe("");
  });

  it("ignores a slower, superseded response so it can't overwrite a newer directory listing", async () => {
    const slow = deferred();
    const fast = deferred();
    const gateway = fakeGateway((_workspaceId, path) =>
      path === "slow-dir" ? slow.promise : fast.promise,
    );
    const browser = new NativeFileBrowser(container, pathEl, gateway, "workspace-a");

    const firstLoad = browser.load("slow-dir");
    const secondLoad = browser.load("fast-dir");

    fast.resolve({
      entries: [{ name: "fast.txt", relativePath: "fast-dir/fast.txt", kind: "file" }],
    });
    await secondLoad;
    expect(browser.currentPath).toBe("fast-dir");

    slow.resolve({
      entries: [{ name: "slow.txt", relativePath: "slow-dir/slow.txt", kind: "file" }],
    });
    await firstLoad;

    expect(browser.currentPath).toBe("fast-dir");
    expect(container.textContent).toContain("fast.txt");
    expect(container.textContent).not.toContain("slow.txt");
  });

  it("shows an error message when the request rejects", async () => {
    const gateway = fakeGateway(async () => {
      throw new Error("Requested path is outside the registered workspace");
    });
    const browser = new NativeFileBrowser(container, pathEl, gateway, "workspace-a");

    await browser.load("../etc");

    expect(container.textContent).toContain("outside the registered workspace");
  });

  it("highlights a specific entry and clears it with a null highlight", async () => {
    const gateway = fakeGateway(async () => ({
      entries: [
        { name: "a.txt", relativePath: "docs/a.txt", kind: "file" },
        { name: "b.txt", relativePath: "docs/b.txt", kind: "file" },
      ],
    }));
    const browser = new NativeFileBrowser(container, pathEl, gateway, "workspace-a");
    await browser.load("docs");

    browser.setHighlight("docs/b.txt");
    let highlighted = container.querySelectorAll(".file-item.is-highlighted");
    expect(highlighted.length).toBe(1);
    expect(highlighted[0].textContent).toContain("b.txt");

    browser.setHighlight(null);
    highlighted = container.querySelectorAll(".file-item.is-highlighted");
    expect(highlighted.length).toBe(0);
  });

  it("selects a file row on click and opens it natively on double-click", async () => {
    const gateway = fakeGateway(async () => ({
      entries: [
        { name: "readme.md", relativePath: "readme.md", kind: "file", size: 12 },
        { name: "src", relativePath: "src", kind: "directory" },
      ],
    }));
    const onOpenFile = vi.fn();
    const browser = new NativeFileBrowser(
      container,
      pathEl,
      gateway,
      "workspace-a",
      { onOpenFile },
    );
    await browser.load();

    const fileRow = container.querySelector('[data-path="readme.md"]');
    expect(fileRow).toBeTruthy();
    expect(fileRow.tagName).toBe("BUTTON");
    expect(fileRow.textContent).toContain("12 B");

    fileRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      container.querySelector('[data-path="readme.md"]').classList.contains(
        "is-highlighted",
      ),
    ).toBe(true);

    fileRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onOpenFile).toHaveBeenCalledWith("readme.md");

    // Directory rows still navigate on a plain click instead of opening files.
    const directoryRow = container.querySelector('[data-path="src"]');
    expect(directoryRow.tagName).toBe("BUTTON");
  });

  it("marks dragged rows with the workspace-relative path for the composer", async () => {
    const gateway = fakeGateway(async () => ({
      entries: [
        { name: "readme.md", relativePath: "docs/readme.md", kind: "file" },
        { name: "src", relativePath: "src", kind: "directory" },
      ],
    }));
    const browser = new NativeFileBrowser(container, pathEl, gateway, "workspace-a");
    await browser.load();

    for (const relativePath of ["docs/readme.md", "src"]) {
      const row = container.querySelector(`[data-path="${relativePath}"]`);
      expect(row.getAttribute("draggable")).toBe("true");
      const transfer = new DataTransferStub();
      const event = new Event("dragstart", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: transfer,
        configurable: true,
      });
      row.dispatchEvent(event);
      expect(transfer.getData("application/x-zicode-file")).toBe(relativePath);
      expect(transfer.getData("text/plain")).toBe(relativePath);
    }
  });
});
