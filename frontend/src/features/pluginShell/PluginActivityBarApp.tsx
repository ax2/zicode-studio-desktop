import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type {
  PluginActivityItem,
  PluginShellBarStoreHook,
} from "./pluginShellStore";

type SvgShape = ["path" | "circle", Record<string, string>];

const ICON_PATHS: Record<string, SvgShape[]> = {
  chat: [
    ["path", { d: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" }],
    ["path", { d: "M8 9h8M8 13h5" }],
  ],
  notes: [
    ["path", { d: "M6 3h9l3 3v15H6z" }],
    ["path", { d: "M14 3v4h4M9 11h6M9 15h6" }],
  ],
  finance: [
    ["path", { d: "M4 19V9M10 19V5M16 19v-7M22 19H2" }],
    ["path", { d: "m3 7 5-4 5 5 7-6" }],
  ],
  projects: [
    ["path", { d: "M3 6h7l2 2h9v11H3z" }],
    ["path", { d: "M7 13h10M7 16h6" }],
  ],
  tasks: [
    ["path", { d: "M6 3h12v18H6z" }],
    ["path", { d: "m9 9 1.5 1.5L14 7M9 15h5" }],
  ],
  automation: [
    ["path", { d: "M4 7h10M14 7l-2-2M14 7l-2 2M20 17H10M10 17l2-2M10 17l2 2" }],
    ["circle", { cx: "6", cy: "17", r: "2" }],
    ["circle", { cx: "18", cy: "7", r: "2" }],
  ],
  files: [
    ["path", { d: "M3 6h7l2 2h9v11H3z" }],
    ["path", { d: "M3 10h18" }],
  ],
  artifacts: [
    ["path", { d: "M4 4h16v16H4z" }],
    ["path", { d: "M8 15l3-3 2 2 3-4 2 3M8 8h3" }],
  ],
  idphoto: [
    [
      "path",
      { d: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" },
    ],
    ["circle", { cx: "12", cy: "11", r: "3" }],
    ["path", { d: "M7 19c.9-2.5 2.7-3.8 5-3.8s4.1 1.3 5 3.8" }],
  ],
  imagetools: [
    [
      "path",
      { d: "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" },
    ],
    ["circle", { cx: "9", cy: "9", r: "2" }],
    ["path", { d: "m21 15-4.5-4.5L9 18" }],
  ],
  documents: [
    ["path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }],
    ["path", { d: "M14 2v6h6M9 13h6M9 17h6" }],
  ],
  clipboard: [
    ["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M9 2h6v4H9zM9 12h6M9 16h6" }],
  ],
  graph: [
    ["circle", { cx: "5", cy: "6", r: "2" }],
    ["circle", { cx: "19", cy: "6", r: "2" }],
    ["circle", { cx: "12", cy: "18", r: "2" }],
    ["path", { d: "M7 6h10M6.5 7.5 11 16.5M17.5 7.5 13 16.5" }],
  ],
  habits: [
    ["circle", { cx: "12", cy: "12", r: "8" }],
    ["path", { d: "m8.5 12 2.5 2.5 4.5-5" }],
  ],
  translate: [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["path", { d: "M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" }],
  ],
  watch: [
    ["circle", { cx: "12", cy: "12", r: "8" }],
    ["circle", { cx: "12", cy: "12", r: "3" }],
    ["path", { d: "M12 4 14 8M20 12l-4 2M12 20l-2-4M4 12l4-2" }],
  ],
  articles: [
    ["path", { d: "m16 3 5 5L8 21H3v-5L16 3z" }],
    ["path", { d: "m13 6 5 5" }],
  ],
  ocr: [
    ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" }],
    ["path", { d: "M7 9h10M7 13h7M7 17h4" }],
  ],
  plugins: [
    ["path", { d: "M8 3v4M16 3v4M5 7h14v5a7 7 0 0 1-14 0Z" }],
    ["path", { d: "M9 21v-3M15 21v-3" }],
  ],
  command: [
    [
      "path",
      { d: "M9 6H7a3 3 0 1 0 3 3V7a3 3 0 1 0-3 3H5M15 18h2a3 3 0 1 0-3-3v2a3 3 0 1 0 3-3h2" },
    ],
  ],
  settings: [
    ["circle", { cx: "12", cy: "12", r: "3" }],
    [
      "path",
      {
        d: "M19 12a7 7 0 0 0-.1-1l2-1-2-4-2 1a7 7 0 0 0-2-1l-.3-3h-5L9 6a7 7 0 0 0-2 1L5 6 3 10l2 1a7 7 0 0 0 0 2l-2 1 2 4 2-1a7 7 0 0 0 2 1l.5 3h5l.5-3a7 7 0 0 0 2-1l2 1 2-4-2-1a7 7 0 0 0 .1-1Z",
      },
    ],
  ],
  help: [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["path", { d: "M9.8 9a2.4 2.4 0 1 1 4.4 1.3c-.7 1-2.2 1.2-2.2 2.7M12 17h.01" }],
  ],
  more: [
    ["circle", { cx: "5", cy: "12", r: "1" }],
    ["circle", { cx: "12", cy: "12", r: "1" }],
    ["circle", { cx: "19", cy: "12", r: "1" }],
  ],
  close: [["path", { d: "M6 6l12 12M18 6 6 18" }]],
  add: [["path", { d: "M12 5v14M5 12h14" }]],
  clip: [["path", { d: "m10 13 4-4a3 3 0 1 1 4 4l-6 6a5 5 0 0 1-7-7l6-6" }]],
  open: [
    ["path", { d: "M14 4h6v6M20 4l-9 9" }],
    ["path", { d: "M18 13v6H5V6h6" }],
  ],
  export: [
    ["path", { d: "M12 3v12M8 7l4-4 4 4" }],
    ["path", { d: "M5 13v7h14v-7" }],
  ],
  chevron: [["path", { d: "m9 18 6-6-6-6" }]],
};

interface KeyedShape {
  key: string;
  tag: "path" | "circle";
  attributes: Record<string, string>;
}

const ICON_SHAPES: Record<string, KeyedShape[]> = Object.fromEntries(
  Object.entries(ICON_PATHS).map(([name, shapes]) => [
    name,
    shapes.map(([tag, attributes], index) => ({
      key: `${tag}-${index}`,
      tag,
      attributes,
    })),
  ]),
);

export function PluginIcon({ name }: { name: string }) {
  const shapes = ICON_SHAPES[name] ?? ICON_SHAPES.artifacts;
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes.map((shape) =>
        shape.tag === "path" ? (
          <path key={shape.key} {...shape.attributes} />
        ) : (
          <circle key={shape.key} {...shape.attributes} />
        ),
      )}
    </svg>
  );
}

function ActivityButton({
  item,
  isActive,
  shortcut,
  onActivate,
}: {
  item: PluginActivityItem;
  isActive: boolean;
  shortcut?: string;
  onActivate(item: PluginActivityItem): void;
}) {
  const badge = item.badge && item.badge.count > 0 ? item.badge : null;
  const title = shortcut
    ? `${item.label} — ${item.description ?? ""} (${shortcut})`
    : `${item.label}${item.description ? ` — ${item.description}` : ""}`;
  const ariaKeyshortcuts = shortcut ? shortcut.replace(/^Ctrl/, "Control") : undefined;
  return (
    <button
      type="button"
      className={`plugin-activity-button${item.system ? " plugin-activity-button--system" : ""}${
        isActive ? " active" : ""
      }`}
      data-plugin-id={item.id}
      title={title}
      aria-label={item.label}
      aria-keyshortcuts={ariaKeyshortcuts}
      aria-current={isActive ? "page" : undefined}
      onClick={() => onActivate(item)}
    >
      <PluginIcon name={item.icon} />
      <span className="plugin-activity-tooltip">
        {item.label}
        {shortcut ? <span className="plugin-activity-shortcut">{shortcut}</span> : null}
      </span>
      {badge ? (
        <span
          className={`plugin-activity-badge tone-${badge.tone || "info"}`}
          role="img"
          aria-label={`${badge.count} ${t("background updates")}`}
        >
          {badge.count > 9 ? "9+" : String(badge.count)}
        </span>
      ) : null}
    </button>
  );
}

export function PluginActivityBarApp({
  store,
  onActivate,
  onSystemActivate,
  onMoreClick,
  onBackdropClick,
  onMenuClose,
  onMenuItemClick,
}: {
  store: PluginShellBarStoreHook;
  onActivate(item: PluginActivityItem): void;
  onSystemActivate(item: PluginActivityItem): void;
  onMoreClick(): void;
  onBackdropClick(): void;
  onMenuClose(): void;
  onMenuItemClick(item: PluginActivityItem): void;
}) {
  const activities = store((state) => state.activities);
  const systemItems = store((state) => state.systemItems);
  const secondaryItems = store((state) => state.secondaryItems);
  const activePluginId = store((state) => state.activePluginId);
  const mobileOpen = store((state) => state.mobileOpen);
  const secondarySelected = store((state) => state.secondarySelected);
  const moreLabel = store((state) => state.moreLabel);
  const listRef = useRef<HTMLDivElement>(null);
  const [listOverflow, setListOverflow] = useState({ top: false, bottom: false });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure overflow when the activity list length changes
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = list;
      const scrollable = scrollHeight > clientHeight + 1;
      setListOverflow({
        top: scrollable && scrollTop > 1,
        bottom: scrollable && scrollTop + clientHeight < scrollHeight - 1,
      });
    };
    update();
    list.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      list.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [activities.length]);

  return (
    <nav className="plugin-activity-bar" aria-label={t("Applications")}>
      <div className="plugin-activity-brand">
        <img src="icons/zicode-mark.svg" alt="" />
      </div>
      <div
        ref={listRef}
        className={`plugin-activity-list${listOverflow.top ? " can-scroll-up" : ""}${
          listOverflow.bottom ? " can-scroll-down" : ""
        }`}
        data-plugin-activities
      >
        {activities.map((item, index) => (
          <ActivityButton
            key={item.id}
            item={item}
            isActive={item.id === activePluginId}
            shortcut={index < 9 ? `Ctrl+${index + 1}` : undefined}
            onActivate={onActivate}
          />
        ))}
      </div>
      <div className="plugin-activity-spacer"></div>
      <div className="plugin-activity-list plugin-activity-list--system" data-system-activities>
        {systemItems.map((item) => (
          <ActivityButton
            key={item.id}
            item={item}
            isActive={item.id === activePluginId}
            onActivate={onSystemActivate}
          />
        ))}
      </div>
      <button
        type="button"
        className={`plugin-activity-button plugin-activity-button--system plugin-mobile-activity-more${
          secondarySelected ? " active" : ""
        }`}
        data-mobile-activity-more
        title={moreLabel}
        aria-label={moreLabel}
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
        aria-controls="mobile-activity-menu"
        aria-current={secondarySelected ? "page" : undefined}
        onClick={onMoreClick}
      >
        <PluginIcon name="more" />
        <span className="plugin-activity-tooltip">{t("More")}</span>
      </button>
      <button
        type="button"
        className="plugin-mobile-activity-backdrop"
        data-mobile-activity-backdrop
        aria-label={t("Close")}
        hidden={!mobileOpen}
        onClick={onBackdropClick}
      ></button>
      <section
        id="mobile-activity-menu"
        className="plugin-mobile-activity-menu"
        data-mobile-activity-menu
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-activity-menu-title"
        hidden={!mobileOpen}
      >
        <header className="plugin-mobile-activity-menu-header">
          <strong id="mobile-activity-menu-title" data-mobile-activity-menu-title>
            {t("All applications")}
          </strong>
          <button
            type="button"
            className="icon-btn plugin-mobile-activity-menu-close"
            data-mobile-activity-menu-close
            aria-label={t("Close")}
            onClick={onMenuClose}
          >
            <PluginIcon name="close" />
          </button>
        </header>
        <div className="plugin-mobile-activity-menu-grid" data-mobile-activity-menu-grid>
          {secondaryItems.map((item) => {
            const isActive = item.id === activePluginId;
            return (
              <button
                type="button"
                className={`plugin-mobile-activity-menu-item${isActive ? " active" : ""}`}
                data-mobile-plugin-id={item.id}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                key={item.id}
                onClick={() => onMenuItemClick(item)}
              >
                <PluginIcon name={item.icon} />
                <span className="plugin-mobile-activity-menu-label">
                  <span>{item.label}</span>
                  {item.description ? (
                    <small className="plugin-mobile-activity-menu-description">
                      {item.description}
                    </small>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </nav>
  );
}
