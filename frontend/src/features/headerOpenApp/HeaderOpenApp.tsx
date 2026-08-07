import { logoForApp, type InstalledApp } from "./headerOpenAppLogic";
import type { StoreApi, UseBoundStore } from "zustand";

export interface HeaderOpenAppStoreShape {
  apps: InstalledApp[];
  path: string;
  selectedId: string | null;
  menuOpen: boolean;
}

export type HeaderOpenAppStoreHook = UseBoundStore<
  StoreApi<HeaderOpenAppStoreShape>
>;

export function HeaderOpenAppBridge({
  store,
  onButtonClick,
  onToggleClick,
  onItemClick,
}: {
  store: HeaderOpenAppStoreHook;
  onButtonClick(): void;
  onToggleClick(): void;
  onItemClick(app: InstalledApp): void;
}) {
  const apps = store((state) => state.apps);
  const selectedId = store((state) => state.selectedId);
  const menuOpen = store((state) => state.menuOpen);
  return (
    <HeaderOpenApp
      apps={apps}
      selectedId={selectedId}
      menuOpen={menuOpen}
      onButtonClick={onButtonClick}
      onToggleClick={onToggleClick}
      onItemClick={onItemClick}
    />
  );
}

function AppLogo({ app }: { app: InstalledApp | null | undefined }) {
  const logo = logoForApp(app);
  return logo.type === "img" ? (
    <img src={logo.src} alt="" className="header-open-app-logo-img" />
  ) : (
    <span className="header-open-app-logo-text">{logo.label}</span>
  );
}

export function HeaderOpenApp({
  apps,
  selectedId,
  menuOpen,
  onButtonClick,
  onToggleClick,
  onItemClick,
}: {
  apps: InstalledApp[];
  selectedId: string | null;
  menuOpen: boolean;
  onButtonClick(): void;
  onToggleClick(): void;
  onItemClick(app: InstalledApp): void;
}) {
  const selected = apps.find((app) => app.id === selectedId) ?? apps[0] ?? null;
  return (
    <>
      <button
        id="header-open-app-btn"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onButtonClick();
        }}
      >
        <span id="header-open-app-logo">
          <AppLogo app={selected} />
        </span>
      </button>
      <button
        id="header-open-app-toggle"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleClick();
        }}
      ></button>
      <div className={`header-open-app-menu${menuOpen ? "" : " hidden"}`} id="header-open-app-menu">
        {apps.map((app) => (
          <button
            type="button"
            className={`header-open-app-menu-item${app.id === selectedId ? " active" : ""}`}
            title={`Open in ${app.label}`}
            aria-label={`Open in ${app.label}`}
            key={app.id}
            onClick={(event) => {
              event.stopPropagation();
              onItemClick(app);
            }}
          >
            <span className="header-open-app-logo" aria-hidden="true">
              <AppLogo app={app} />
            </span>
            <span>{app.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
