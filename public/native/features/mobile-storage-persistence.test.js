import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupMobileStoragePersistence } from "../react/mobile-storage-persistence.js";

function renderDom() {
  document.body.innerHTML = `
    <section id="mobile-task-notification-section" class="hidden">
      <div id="mobile-draft-storage-row" class="hidden"></div>
      <button id="protect-mobile-draft-storage" type="button"></button>
      <p id="mobile-draft-storage-status"></p>
    </section>`;
}

describe("mobile storage persistence", () => {
  beforeEach(renderDom);

  it("stays hidden for the desktop client", () => {
    expect(setupMobileStoragePersistence({ clientType: "desktop" })).toBeNull();
    expect(document.getElementById("mobile-draft-storage-row").classList).toContain("hidden");
  });

  it("shows when draft storage is already protected", async () => {
    const view = setupMobileStoragePersistence({
      clientType: "remote",
      navigatorRef: {
        storage: {
          estimate: vi.fn(async () => ({ quota: 50 * 1024 * 1024, usage: 2 * 1024 * 1024 })),
          persist: vi.fn(),
          persisted: vi.fn(async () => true),
        },
      },
    });

    await vi.waitFor(() => expect(document.getElementById("mobile-draft-storage-status").dataset.state).toBe("protected"));
    expect(document.getElementById("protect-mobile-draft-storage").disabled).toBe(true);
    expect(document.getElementById("mobile-draft-storage-status").textContent).toMatch(/2\.0 MB.*50 MB/);
    view.dispose();
  });

  it("requests protection only after the user activates the button", async () => {
    const persist = vi.fn(async () => true);
    const view = setupMobileStoragePersistence({
      clientType: "remote",
      navigatorRef: {
        storage: {
          estimate: vi.fn(async () => ({ quota: 100 * 1024 * 1024, usage: 0 })),
          persist,
          persisted: vi.fn(async () => false),
        },
      },
    });
    await vi.waitFor(() => expect(document.getElementById("mobile-draft-storage-status").dataset.state).toBe("available"));
    expect(persist).not.toHaveBeenCalled();

    document.getElementById("protect-mobile-draft-storage").click();

    await vi.waitFor(() => expect(document.getElementById("mobile-draft-storage-status").dataset.state).toBe("protected"));
    expect(persist).toHaveBeenCalledOnce();
    view.dispose();
  });

  it("explains when the browser declines persistence", async () => {
    const view = setupMobileStoragePersistence({
      clientType: "remote",
      navigatorRef: {
        storage: {
          persist: vi.fn(async () => false),
          persisted: vi.fn(async () => false),
        },
      },
    });
    await vi.waitFor(() => expect(document.getElementById("mobile-draft-storage-status").dataset.state).toBe("available"));

    document.getElementById("protect-mobile-draft-storage").click();

    await vi.waitFor(() => expect(document.getElementById("mobile-draft-storage-status").dataset.state).toBe("denied"));
    expect(document.getElementById("protect-mobile-draft-storage").disabled).toBe(false);
    expect(document.getElementById("mobile-draft-storage-status").textContent).toMatch(/did not grant|未授予/);
    view.dispose();
  });

  it("renders an honest unsupported state", async () => {
    const view = setupMobileStoragePersistence({
      clientType: "remote",
      navigatorRef: { storage: {} },
    });

    await vi.waitFor(() => expect(document.getElementById("mobile-draft-storage-status").dataset.state).toBe("unsupported"));
    expect(document.getElementById("protect-mobile-draft-storage").disabled).toBe(true);
    view.dispose();
  });
});
