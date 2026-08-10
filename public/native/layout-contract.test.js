import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const index = readFileSync(join(process.cwd(), "public/index.html"), "utf8");
const manifest = readFileSync(join(process.cwd(), "public/manifest.json"), "utf8");
const main = readFileSync(join(process.cwd(), "src-tauri/src/main.rs"), "utf8");
const pluginShellCss = readFileSync(
  join(process.cwd(), "public/native/plugins/plugin-shell.css"),
  "utf8",
);
const pluginShell = readFileSync(
  join(process.cwd(), "public/native/plugins/plugin-shell.js"),
  "utf8",
);
const helpCss = readFileSync(join(process.cwd(), "public/native/features/help-center.css"), "utf8");
const headerCss = readFileSync(join(process.cwd(), "public/native/header.css"), "utf8");
const mobileCss = readFileSync(join(process.cwd(), "public/native/mobile.css"), "utf8");
const messageRendererCss = readFileSync(
  join(process.cwd(), "public/ui/message-renderer.css"),
  "utf8",
);
const taskCenterCss = readFileSync(
  join(process.cwd(), "public/native/plugins/task-center-app.css"),
  "utf8",
);
const artifactCss = readFileSync(
  join(process.cwd(), "public/native/plugins/artifact-app.css"),
  "utf8",
);
const financeCss = readFileSync(
  join(process.cwd(), "public/native/features/finance-workbench.css"),
  "utf8",
);
const costDashboardCss = readFileSync(
  join(process.cwd(), "public/native/settings/cost-dashboard.css"),
  "utf8",
);
const costDashboardRender = readFileSync(
  join(process.cwd(), "frontend/src/features/settings/CostDashboardTab.tsx"),
  "utf8",
);
const markdownCss = readFileSync(join(process.cwd(), "public/ui/markdown.css"), "utf8");
const remoteAccessCss = readFileSync(
  join(process.cwd(), "public/native/settings/remote-access-settings.css"),
  "utf8",
);
const notesCss = readFileSync(
  join(process.cwd(), "public/native/plugins/notes-app.css"),
  "utf8",
);
const automationCss = readFileSync(
  join(process.cwd(), "public/native/plugins/automation-app.css"),
  "utf8",
);
const mobileExperienceCss = readFileSync(
  join(process.cwd(), "public/native/features/mobile-experience.css"),
  "utf8",
);
const startupFailureCss = readFileSync(
  join(process.cwd(), "public/native/features/startup-failure.css"),
  "utf8",
);
const offlineHtml = readFileSync(join(process.cwd(), "public/offline.html"), "utf8");
const packageBrowseCss = readFileSync(
  join(process.cwd(), "public/native/settings/package-browse.css"),
  "utf8",
);
const composerImagesCss = readFileSync(
  join(process.cwd(), "public/native/composer/composer-images.css"),
  "utf8",
);
const slashMenuCss = readFileSync(
  join(process.cwd(), "public/native/composer/composer-slash-menu.css"),
  "utf8",
);
const composerCss = readFileSync(join(process.cwd(), "public/native/composer.css"), "utf8");
const workspaceAppCss = readFileSync(
  join(process.cwd(), "public/native/plugins/project-workspace-app.css"),
  "utf8",
);
const settingsConfigCss = readFileSync(
  join(process.cwd(), "public/native/settings/settings-config.css"),
  "utf8",
);
const commandPaletteCss = readFileSync(
  join(process.cwd(), "public/native/extensions/command-palette.css"),
  "utf8",
);
const lanQrCss = readFileSync(
  join(process.cwd(), "public/native/features/lan-qr.css"),
  "utf8",
);
const sceneIndicatorCss = readFileSync(
  join(process.cwd(), "public/native/features/scene-indicator.css"),
  "utf8",
);
const dialogCss = readFileSync(
  join(process.cwd(), "public/native/extensions/dialog.css"),
  "utf8",
);
const inlinePromptCss = readFileSync(
  join(process.cwd(), "public/native/extensions/inline-extension-prompt.css"),
  "utf8",
);
const sessionSearchCss = readFileSync(
  join(process.cwd(), "public/native/session/session-search-dialog.css"),
  "utf8",
);
const chatSettingsCss = readFileSync(
  join(process.cwd(), "public/components/chat-settings-panel.css"),
  "utf8",
);
const rpivTodoCss = readFileSync(
  join(process.cwd(), "public/native/features/rpiv-todo-mirror.css"),
  "utf8",
);
const pluginViewHostCss = readFileSync(
  join(process.cwd(), "public/native/plugins/plugin-view-host.css"),
  "utf8",
);
const superAgentRuntimeCss = readFileSync(
  join(process.cwd(), "public/components/super-agent-runtime.css"),
  "utf8",
);
const appJs = readFileSync(join(process.cwd(), "public/native/app.js"), "utf8");
const sessionSidebarCss = readFileSync(
  join(process.cwd(), "public/native/session/session-sidebar.css"),
  "utf8",
);
const messagesCss = readFileSync(
  join(process.cwd(), "public/native/messages.css"),
  "utf8",
);
const imageLightboxCss = readFileSync(
  join(process.cwd(), "public/ui/image-lightbox.css"),
  "utf8",
);
const historyWindowCss = readFileSync(
  join(process.cwd(), "public/native/session/history-window.css"),
  "utf8",
);
const thinkingEffortCss = readFileSync(
  join(process.cwd(), "public/native/settings/thinking-effort-control.css"),
  "utf8",
);
const settingsPanelCss = readFileSync(
  join(process.cwd(), "public/native/settings/settings-panel.css"),
  "utf8",
);
const fileBrowserCss = readFileSync(
  join(process.cwd(), "public/native/workspace/file-browser.css"),
  "utf8",
);
const globalStyleCss = readFileSync(join(process.cwd(), "public/style.css"), "utf8");
const sidebarCss = readFileSync(join(process.cwd(), "public/native/sidebar.css"), "utf8");
const themeCss = readFileSync(join(process.cwd(), "public/style-theme.css"), "utf8");

describe("desktop three-region layout contract", () => {
  it("clips off-canvas side panels so they never widen the document", () => {
    expect(headerCss).toMatch(/\.main\s*\{[^}]*overflow:\s*hidden/s);
    expect(headerCss).toMatch(/\.main\s*\{[^}]*min-width:\s*0/s);
  });

  it("moves the collapsed file panel fully off-canvas", () => {
    const styleCss = readFileSync(join(process.cwd(), "public/style.css"), "utf8");
    expect(styleCss).toMatch(/\.app-side-panel\.collapsed\s*\{[^}]*translateX\(100%\)/s);
    expect(styleCss).toMatch(/\.app-side-panel\s*\{[^}]*position:\s*absolute/s);
  });

  it("keeps session action buttons keyboard-reachable via focus-within", () => {
    expect(sessionSidebarCss).toMatch(
      /\.session-item:focus-within \.session-more-btn\s*\{[^}]*visibility:\s*visible/s,
    );
    expect(sessionSidebarCss).toMatch(
      /\.session-item:focus-within \.session-archive-btn\s*\{[^}]*visibility:\s*visible/s,
    );
    expect(sessionSidebarCss).toMatch(/\.project-header:focus-within \.project-more-btn/);
    expect(sessionSidebarCss).toMatch(
      /\.project-more-btn:focus-visible\s*\{[^}]*visibility:\s*visible/s,
    );
  });

  it("keeps settings and help in navigation without duplicate Chat sidebar entries", () => {
    expect(index).not.toContain('id="settings-btn"');
    expect(index).not.toContain('id="help-btn"');
    expect(index).not.toContain('class="mode-toggle"');
    expect(index).toContain('id="settings-root"');
    expect(index).toContain('id="help-center"');
  });

  it("removes the top bar while preserving the file manager control for navigation", () => {
    expect(index).not.toContain('id="workspace-indicator"');
    expect(index).not.toContain('id="header-open-app"');
    expect(index).toContain('id="file-sidebar-toggle"');
    expect(headerCss).toMatch(/\.header\s*\{[\s\S]*?display:\s*none/);
    expect(pluginShell).toContain('id: "core.files"');
  });

  it("does not install a native application menu", () => {
    expect(main).not.toContain(".menu(build_app_menu)");
    expect(main).not.toContain("fn build_app_menu");
  });

  it("keeps embedded Settings and Help responsive", () => {
    expect(pluginShellCss).toContain('body[data-active-plugin="core.settings"]');
    expect(pluginShellCss).toContain('body[data-active-plugin="core.help"]');
    expect(helpCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*\.help-center-layout--embedded\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it("reflows the three regions into mobile navigation, drawer, and main view", () => {
    expect(mobileCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)/,
    );
    expect(mobileCss).toMatch(/\.plugin-activity-bar\s*\{[\s\S]*position:\s*fixed[\s\S]*bottom:\s*0/);
    expect(mobileCss).toMatch(/\.sidebar\s*\{[\s\S]*position:\s*fixed/);
    expect(mobileCss).toContain('--mobile-navigation-inset: var(--mobile-nav-height)');
    expect(mobileCss).toContain('body[data-active-plugin="core.settings"] .settings-nav');
    expect(mobileCss).toContain('body[data-active-plugin="core.help"] .help-center-navigation');
    expect(mobileCss).toContain(".session-search-dialog");
    expect(mobileCss).toContain(".plugin-mobile-activity-menu");
    expect(mobileCss).toContain('[data-plugin-id="core.files"]');
    expect(mobileCss).toContain(
      "var(--mobile-nav-height) + max(var(--space-2), env(safe-area-inset-bottom, 0px))",
    );
    expect(mobileCss).toMatch(
      /@media \(max-width: 360px\)[\s\S]*\.composer-toolbar\s*\{[\s\S]*flex-wrap:\s*wrap/,
    );
  });

  it("keeps message actions touchable on narrow or coarse-pointer devices", () => {
    expect(messageRendererCss).toMatch(
      /@media \(max-width: 768px\), \(pointer: coarse\)[\s\S]*\.message-share-btn,[\s\S]*min-width:\s*40px;[\s\S]*min-height:\s*40px;/,
    );
  });

  it("uses a touch-safe form and design-system control baseline on mobile", () => {
    expect(mobileCss).toMatch(
      /:is\(button, \.ui-button, \.ui-icon-button\)\s*\{[\s\S]*?min-height:\s*var\(--space-10\)/,
    );
    expect(mobileCss).toMatch(
      /\.ui-icon-button\s*\{[\s\S]*?min-width:\s*var\(--space-10\)[\s\S]*?height:\s*var\(--space-10\)/,
    );
    expect(mobileCss).toContain('input:not([type="checkbox"])');
    expect(mobileCss).toContain(':not([type="file"])');
    expect(mobileCss).toMatch(
      /input:not\([\s\S]*?select[\s\S]*?min-height:\s*var\(--space-10\);[\s\S]*?font-size:\s*var\(--font-size-lg\)/,
    );
    expect(mobileCss).toMatch(
      /:is\(textarea:not\(\[hidden\]\), \.ui-textarea\)[\s\S]*?font-size:\s*var\(--font-size-lg\)/,
    );
    expect(mobileCss).toMatch(
      /label:has\(> input\[type="checkbox"\]\)[\s\S]*?label:has\(> input\[type="radio"\]\)[\s\S]*?min-height:\s*var\(--space-10\)/,
    );
  });

  it("reflows task summaries, actions, and artifact metadata for narrow screens", () => {
    expect(taskCenterCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.task-center-main\s*\{\s*padding:\s*0/,
    );
    expect(taskCenterCss).toMatch(
      /\.task-center-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(taskCenterCss).toMatch(
      /\.task-center-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(artifactCss).toMatch(
      /\.artifacts-document-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(artifactCss).toMatch(/\.artifacts-metadata\s*\{\s*grid-template-columns:\s*1fr/);
  });

  it("keeps finance workbench result text, event rows, and actions inside narrow screens", () => {
    expect(financeCss).toMatch(
      /\.finance-result-card code[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(financeCss).toMatch(
      /\.finance-paper-account code[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(financeCss).toMatch(
      /\.finance-research-evidence p[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(financeCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.finance-form-actions\s*\{\s*flex-wrap:\s*wrap/,
    );
    expect(financeCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.finance-event-row\s*\{\s*flex-wrap:\s*wrap/,
    );
    expect(financeCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.finance-research-card\s*>\s*header\s*\{\s*flex-wrap:\s*wrap/,
    );
  });

  it("centers lone finance and artifact state panels so tall desktop windows do not read as blank", () => {
    expect(financeCss).toMatch(
      /\.finance-plugin-main:has\(\.finance-scene-guard\)\s*\{\s*display:\s*flex;\s*flex-direction:\s*column/,
    );
    expect(financeCss).toMatch(
      /\.finance-plugin-main:has\(\.finance-scene-guard\)\s+\.finance-scene-guard\s*\{\s*margin:\s*auto/,
    );
    expect(artifactCss).toMatch(
      /\.artifacts-main:has\(\.artifacts-state-panel\)\s*\{\s*min-height:\s*100%;\s*display:\s*flex;\s*flex-direction:\s*column/,
    );
    expect(artifactCss).toMatch(
      /\.artifacts-main:has\(\.artifacts-state-panel\)\s+\.artifacts-state-panel\s*\{\s*margin:\s*auto/,
    );
  });

  it("stacks cost dashboard panels and keeps wide tables scrollable on narrow screens", () => {
    expect(costDashboardCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.cost-dash-section-row\s*\{\s*grid-template-columns:\s*1fr/,
    );
    expect(costDashboardCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.cost-dash-tool-chart-layout\s*\{\s*flex-direction:\s*column/,
    );
    expect(costDashboardCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.cost-dash-activity-wrap\s*\{\s*overflow-x:\s*auto/,
    );
    expect(costDashboardCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.cost-dash-activity-calendar\s*\{\s*min-width:\s*560px/,
    );
    expect(costDashboardRender).toContain('className="cost-dash-sessions-table-wrap"');
    expect(costDashboardRender).toContain('role="region"');
    expect(costDashboardRender).toMatch(/aria-label[^>]*Sessions table/);
  });

  it("keeps help center navigation, articles, and tables usable on narrow screens", () => {
    expect(helpCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.help-center-toc\s*\{\s*display:\s*none/,
    );
    expect(helpCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.help-center-layout\s*\{\s*display:\s*block[\s\S]*?overflow-y:\s*auto/,
    );
    expect(helpCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.help-center-navigation\s*\{[\s\S]*?max-height:\s*34vh/,
    );
    expect(helpCss).toMatch(
      /\.help-center-article\s*\.table-wrapper\s*\{\s*overflow-x:\s*auto/,
    );
    expect(markdownCss).toMatch(/^pre\s*\{[\s\S]*?overflow-x:\s*auto/m);
  });

  it("keeps remote access addresses and fingerprints wrapped on narrow screens", () => {
    expect(remoteAccessCss).toMatch(
      /\.remote-access-addresses\s*\{[\s\S]*?min-width:\s*0/,
    );
    expect(remoteAccessCss).toMatch(
      /\.remote-access-readiness\s*code[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(remoteAccessCss).toMatch(
      /\.remote-access-readiness\s*>\s*\*\s*\{\s*min-width:\s*0/,
    );
  });

  it("wraps long note source URLs instead of clipping them on narrow screens", () => {
    expect(notesCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.notes-source\s*\{[\s\S]*?white-space:\s*normal[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(notesCss).toMatch(
      /\.notes-source\s*\{[\s\S]*?overflow:\s*hidden[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/,
    );
  });

  it("wraps automation detail values instead of clipping them on narrow screens", () => {
    expect(automationCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.automation-card\s*dd\s*\{[\s\S]*?white-space:\s*normal[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(automationCss).toMatch(
      /\.automation-card\s*dd\s*\{[\s\S]*?overflow:\s*hidden[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/,
    );
  });

  it("keeps mobile connection, install, and startup failure surfaces narrow-screen safe", () => {
    expect(mobileExperienceCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.mobile-connection-status\s*\{[\s\S]*?width:\s*12px[\s\S]*?height:\s*12px/,
    );
    expect(mobileExperienceCss).toMatch(
      /@media \(max-width: 420px\)[\s\S]*?\.mobile-install-card\s*\{[\s\S]*?flex-direction:\s*column/,
    );
    expect(mobileExperienceCss).toMatch(
      /@media \(max-width: 420px\)[\s\S]*?\.mobile-install-actions\s*\.ui-button\s*\{[\s\S]*?min-height:\s*var\(--space-10\)/,
    );
    expect(startupFailureCss).toMatch(
      /\.startup-failure\s*\{[\s\S]*?overflow-y:\s*auto/,
    );
    expect(startupFailureCss).toMatch(
      /\.startup-failure-card\s*\.ui-button\s*\{[\s\S]*?min-height:\s*var\(--space-12\)/,
    );
    expect(offlineHtml).toContain("viewport-fit=cover");
    expect(offlineHtml).toContain('rel="icon" href="data:,"');
  });

  it("wraps long package names and keeps pagination touchable on narrow screens", () => {
    expect(packageBrowseCss).toMatch(
      /\.settings-extension-name\s*\{[\s\S]*?overflow:\s*hidden[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/,
    );
    expect(packageBrowseCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.settings-extension-name\s*\{[\s\S]*?white-space:\s*normal[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(packageBrowseCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.pkg-browse-page-btn\s*\{\s*min-width:\s*40px/,
    );
  });

  it("keeps composer attachments and slash menu touch-safe on mobile", () => {
    expect(composerImagesCss).toMatch(
      /\.image-previews\s*\{[\s\S]*?overflow-x:\s*auto/,
    );
    expect(composerImagesCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.image-preview-remove\s*\{[\s\S]*?width:\s*var\(--control-height-lg\)[\s\S]*?height:\s*var\(--control-height-lg\)/,
    );
    expect(slashMenuCss).toMatch(
      /\.skill-slash-menu\s*\{[\s\S]*?max-height:\s*min\(52vh, 520px\)[\s\S]*?overflow-y:\s*auto/,
    );
    expect(slashMenuCss).toMatch(
      /\.skill-slash-option\s*\{[\s\S]*?min-height:\s*40px/,
    );
  });

  it("stacks project workspace rows and search results on narrow screens", () => {
    expect(workspaceAppCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.project-workspace-main\s*\{\s*padding:\s*0/,
    );
    expect(workspaceAppCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.project-workspace-results\s*li,[\s\S]*?\.project-workspace-activity\s*li,[\s\S]*?\.project-workspace-search-results\s*li\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(workspaceAppCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.project-workspace-knowledge\s*li\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(workspaceAppCss).toMatch(
      /\.project-workspace-search-form\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/,
    );
  });

  it("keeps config editor modal and api-key rows usable on narrow screens", () => {
    expect(settingsConfigCss).toMatch(
      /@media \(max-width: 920px\)[\s\S]*?\.api-provider-toggle\s*\{[\s\S]*?min-width:\s*var\(--space-10\)[\s\S]*?min-height:\s*var\(--space-10\)/,
    );
    expect(settingsConfigCss).toMatch(
      /@media \(max-width: 920px\)[\s\S]*?\.api-key-row-summary\s*\{[\s\S]*?white-space:\s*normal[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(settingsConfigCss).toMatch(
      /\.config-editor-textarea\s*\{[\s\S]*?min-height:\s*280px/,
    );
  });

  it("wraps long message content and keeps wide tables and code scrollable", () => {
    expect(messageRendererCss).toMatch(
      /\.message-content\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(markdownCss).toMatch(
      /\.message\.assistant\s*\.message-content\s*\.table-wrapper\s*\{[\s\S]*?overflow-x:\s*auto/,
    );
    expect(markdownCss).toMatch(
      /\.code-block-wrapper\s*pre\s*\{[\s\S]*?max-width:\s*100%/,
    );
  });

  it("keeps the command palette centered and scrollable on narrow screens", () => {
    expect(commandPaletteCss).toMatch(
      /\.command-palette\s*\{[\s\S]*?width:\s*340px[\s\S]*?max-width:\s*90vw/,
    );
    expect(commandPaletteCss).toMatch(
      /\.command-list\s*\{[\s\S]*?overflow-y:\s*auto/,
    );
    expect(commandPaletteCss).toMatch(
      /\.command-item\s*\{[\s\S]*?width:\s*100%/,
    );
    expect(mobileCss).toMatch(
      /\.command-palette[\s\S]*?max-height:\s*calc\(100dvh - var\(--space-4\)\)/,
    );
  });

  it("keeps the LAN QR pairing modal usable on narrow screens", () => {
    expect(lanQrCss).toMatch(
      /\.lan-qr-modal-content\s*\{[\s\S]*?width:\s*360px[\s\S]*?max-width:\s*100%/,
    );
    expect(lanQrCss).toMatch(
      /\.lan-qr-tab\s*\{[\s\S]*?min-height:\s*var\(--control-height-lg\)/,
    );
    expect(lanQrCss).toMatch(
      /\.lan-qr-tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(lanQrCss).toMatch(
      /\.lan-qr-address,[\s\S]*?\.lan-qr-meta\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(lanQrCss).toMatch(
      /\.lan-qr-fingerprint\s*\{[\s\S]*?display:\s*grid/,
    );
  });

  it("caps the scene indicator and ellipsizes long scene names", () => {
    expect(sceneIndicatorCss).toMatch(
      /\.scene-indicator\s*\{[\s\S]*?max-width:\s*100%/,
    );
    expect(sceneIndicatorCss).toMatch(
      /\.scene-indicator\s*strong\s*\{[\s\S]*?overflow:\s*hidden[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/,
    );
    expect(sceneIndicatorCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.scene-indicator-prefix\s*\{\s*display:\s*none/,
    );
  });

  it("keeps extension dialogs and inline prompts wrapping on narrow screens", () => {
    expect(dialogCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.dialog-body--with-preview\s*\{\s*grid-template-columns:\s*1fr/,
    );
    expect(dialogCss).toMatch(
      /\.dialog-option\s*\{[\s\S]*?grid-template-columns:\s*auto\s*1fr/,
    );
    expect(dialogCss).toMatch(
      /\.dialog-option-label\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    );
    expect(inlinePromptCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.inline-prompt-layout--with-preview\s*\{\s*grid-template-columns:\s*1fr/,
    );
    expect(inlinePromptCss).toMatch(
      /\.inline-prompt-option-label\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    );
  });

  it("keeps the session search dialog full-screen and touch-safe on mobile", () => {
    expect(mobileCss).toMatch(
      /\.session-search-dialog\s*\{[\s\S]*?top:\s*max\(var\(--space-2\), env\(safe-area-inset-top, 0px\)\)[\s\S]*?bottom:\s*max\(var\(--space-2\), env\(safe-area-inset-bottom, 0px\)\)/,
    );
    expect(mobileCss).toMatch(
      /\.session-search-dialog-input\s*\{[\s\S]*?min-height:\s*var\(--space-12\)/,
    );
    expect(mobileCss).toMatch(
      /\.session-search-result\s*\{[\s\S]*?min-height:\s*calc\(var\(--space-12\) \+ var\(--space-3\)\)/,
    );
    expect(sessionSearchCss).toMatch(
      /\.session-search-results\s*\{[\s\S]*?overflow-y:\s*auto/,
    );
    expect(sessionSearchCss).toMatch(
      /\.session-search-result-title\s*\{[\s\S]*?text-overflow:\s*ellipsis/,
    );
  });

  it("stacks chat platform forms and keeps chat settings touch-safe on mobile", () => {
    expect(chatSettingsCss).toMatch(
      /\.chat-platform-form\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(chatSettingsCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.chat-platform-form\s*\{\s*grid-template-columns:\s*1fr/,
    );
    expect(chatSettingsCss).toMatch(
      /\.chat-account-header\s*\{[\s\S]*?justify-content:\s*space-between/,
    );
  });

  it("keeps the rpiv todo mirror panel full-width and readable on mobile", () => {
    expect(rpivTodoCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.rpiv-todo-panel\s*\{[\s\S]*?right:\s*max\(var\(--space-2\), env\(safe-area-inset-right, 0px\)\)[\s\S]*?left:\s*max\(var\(--space-2\), env\(safe-area-inset-left, 0px\)\)[\s\S]*?width:\s*auto/,
    );
    expect(rpivTodoCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.rpiv-todo-panel__text\s*\{[\s\S]*?-webkit-line-clamp:\s*2/,
    );
    expect(rpivTodoCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.rpiv-todo-panel__task\s*\{\s*grid-template-columns:\s*auto\s*minmax\(0,\s*1fr\)/,
    );
    expect(rpivTodoCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.rpiv-todo-panel__header[\s\S]*?min-height:\s*var\(--control-height-lg\)/,
    );
  });

  it("keeps plugin view frames full-width and errors readable on narrow screens", () => {
    expect(pluginViewHostCss).toMatch(
      /\.plugin-view-frame-container--main\s*\{[\s\S]*?width:\s*100%[\s\S]*?height:\s*100%/,
    );
    expect(pluginViewHostCss).toMatch(
      /\.plugin-view-frame\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-height:\s*160px/,
    );
    expect(pluginViewHostCss).toMatch(
      /\.plugin-view-frame-container--sidebar\s*\{[\s\S]*?min-height:\s*160px/,
    );
    expect(pluginViewHostCss).toMatch(
      /\.plugin-view-error\s*p\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    );
  });

  it("keeps super-agent task cards wrapping and titles clipped on narrow screens", () => {
    expect(superAgentRuntimeCss).toMatch(
      /\.runtime-task-title\s*\{[\s\S]*?min-width:\s*0[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/,
    );
    expect(superAgentRuntimeCss).toMatch(
      /\.runtime-task-desc\s*\{[\s\S]*?word-break:\s*break-word/,
    );
    expect(superAgentRuntimeCss).toMatch(
      /\.runtime-task-error\s*\{[\s\S]*?word-break:\s*break-word/,
    );
    expect(superAgentRuntimeCss).toMatch(
      /\.runtime-task-history-item\s*p\s*\{[\s\S]*?word-break:\s*break-word/,
    );
  });

  it("keeps the right file panel off-canvas on the mobile shell", () => {
    expect(mobileCss).toMatch(
      /\.app-side-panel\.app-side-panel\s*\{[\s\S]*?position:\s*fixed/,
    );
    expect(appJs).toContain(
      "(max-width: 768px), (max-height: 520px) and (pointer: coarse)",
    );
    expect(appJs).toMatch(
      /sidebar\.classList\.add\("collapsed"\)/,
    );
  });

  it("keeps session context menu items touch-safe on mobile", () => {
    expect(sessionSidebarCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.context-menu-item\s*\{[\s\S]*?min-height:\s*var\(--space-10\)/,
    );
    expect(sessionSidebarCss).toMatch(
      /\.session-context-menu\s*\{[\s\S]*?min-width:\s*160px/,
    );
  });

  it("wraps long system message text on narrow screens", () => {
    expect(messagesCss).toMatch(
      /\.system-message\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    );
  });

  it("scales the desktop chat column on wide windows instead of leaving gutters", () => {
    expect(themeCss).toMatch(
      /--chat-content-max-width:\s*960px/,
    );
    expect(messagesCss).toMatch(
      /\.messages\s*\{[\s\S]*?padding-left:\s*min\(\s*max\([\s\S]*?var\(--chat-content-max-width\)[\s\S]*?var\(--chat-gutter-max\)[\s\S]*?padding-right:\s*min\(\s*max\([\s\S]*?var\(--chat-content-max-width\)[\s\S]*?var\(--chat-gutter-max\)/,
    );
    expect(composerCss).toMatch(
      /\.input-area\s*\{[\s\S]*?padding-left:\s*min\(\s*max\([\s\S]*?var\(--chat-content-max-width\)[\s\S]*?var\(--chat-gutter-max\)/,
    );
    expect(themeCss).toMatch(
      /--chat-gutter-max:\s*96px/,
    );
    expect(themeCss).toMatch(
      /@media \(min-width: 1536px\)[\s\S]*?--chat-content-max-width:\s*1280px/,
    );
    expect(themeCss).toMatch(
      /@media \(min-width: 1920px\)[\s\S]*?--chat-content-max-width:\s*1440px/,
    );
    expect(themeCss).toMatch(
      /--app-content-max-width:\s*1120px/,
    );
    expect(taskCenterCss).toMatch(
      /\.task-center-main\s*\{[\s\S]*?max-width:\s*var\(--app-content-max-width\)/,
    );
    expect(workspaceAppCss).toMatch(
      /\.project-workspace-main\s*\{[\s\S]*?max-width:\s*var\(--app-content-max-width\)/,
    );
    expect(notesCss).toMatch(
      /\.notes-state-panel\s*\{[\s\S]*?width:\s*min\(var\(--app-content-max-width\),\s*100%\)/,
    );
  });

  it("keeps the welcome screen compact on mobile and space-filling on desktop", () => {
    expect(messageRendererCss).toMatch(
      /\.welcome-quick-actions\s*\{\s*display:\s*none;/,
    );
    expect(messageRendererCss).toMatch(
      /@media \(min-width: 769px\)[\s\S]*?\.welcome\s*\{[\s\S]*?margin:\s*auto\s+0[\s\S]*?\.welcome-quick-actions\s*\{[\s\S]*?display:\s*grid/,
    );
    expect(messageRendererCss).toMatch(
      /\.welcome-quick-action-icon\s*\{[\s\S]*?font-size:\s*var\(--font-size-2xl\)/,
    );
    // Very wide desktop windows use a two-column workbench: brand/scene on
    // the left, quick actions on the right, instead of a centered card.
    expect(messageRendererCss).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*?\.welcome\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*7fr\)\s*minmax\(0,\s*5fr\)[\s\S]*?\.welcome-quick-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it("hides thinking blocks through the show-thinking switch dataset", () => {
    expect(messageRendererCss).toMatch(
      /body\[data-show-thinking="off"\]\s*\.thinking-block\s*\{[\s\S]*?display:\s*none\s*!important/,
    );
  });

  it("localizes command palette system command labels for display and filtering", () => {
    // Raw English labels used to be translated only by the DOM observer, so
    // filtering by the Chinese label matched nothing. Commands must carry
    // localized labels via t().
    expect(appJs).toMatch(/label:\s*t\("Compact"\)/);
    expect(appJs).toMatch(/label:\s*t\("Settings"\)/);
    expect(appJs).toMatch(/label:\s*t\("Help"\)/);
    expect(appJs).toMatch(/desc:\s*t\("Compact context to save tokens"\)/);
  });

  it("keeps the send-later banner and welcome scene narrow-screen safe", () => {
    expect(mobileCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.mobile-send-later\s*\{[\s\S]*?align-items:\s*stretch[\s\S]*?flex-direction:\s*column/,
    );
    expect(mobileCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.mobile-send-later-actions\s*\.ui-button\s*\{[\s\S]*?min-height:\s*var\(--space-10\)/,
    );
    expect(sceneIndicatorCss).toMatch(
      /\.welcome-scene\s*\{[\s\S]*?width:\s*min\(440px,\s*calc\(100% - var\(--space-8\)\)\)/,
    );
  });

  it("keeps history window notice and image lightbox touch-safe on mobile", () => {
    expect(historyWindowCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.history-window-notice\s*\{[\s\S]*?flex-direction:\s*column/,
    );
    expect(historyWindowCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.history-window-load\s*\{[\s\S]*?min-height:\s*var\(--control-height-lg\)/,
    );
    expect(imageLightboxCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.image-lightbox-close\s*\{[\s\S]*?width:\s*var\(--space-10\)[\s\S]*?height:\s*var\(--space-10\)/,
    );
    expect(imageLightboxCss).toMatch(
      /\.image-lightbox-img\s*\{[\s\S]*?max-width:\s*min\(90vw,\s*1200px\)/,
    );
  });

  it("keeps the composer image picker and thinking effort control mobile-safe", () => {
    expect(composerImagesCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.composer-image-picker:not\(\[hidden\]\)\s*\{[\s\S]*?right:\s*max\(var\(--space-2\), env\(safe-area-inset-right, 0px\)\)[\s\S]*?left:\s*max\(var\(--space-2\), env\(safe-area-inset-left, 0px\)\)/,
    );
    expect(composerImagesCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.composer-image-picker-actions\s*\.ui-button,[\s\S]*?\.composer-image-picker-close\s*\{[\s\S]*?min-height:\s*var\(--control-height-lg\)/,
    );
    expect(thinkingEffortCss).toMatch(
      /\.thinking-effort\s*\{[\s\S]*?width:\s*190px/,
    );
    expect(thinkingEffortCss).toMatch(
      /\.thinking-effort-dot\s*\{[\s\S]*?flex:\s*1\s*1\s*0/,
    );
  });

  it("keeps the updater settings rows compact and touch-safe on mobile", () => {
    expect(settingsPanelCss).toMatch(
      /@media \(max-width: 920px\)[\s\S]*?#setting-updater-section\s*\.settings-static-value\s*\{[\s\S]*?max-width:\s*56%[\s\S]*?white-space:\s*nowrap[\s\S]*?text-overflow:\s*ellipsis/,
    );
    expect(settingsPanelCss).toMatch(
      /@media \(max-width: 920px\)[\s\S]*?\.settings-value-btn\s*\{[\s\S]*?max-width:\s*100%/,
    );
  });

  it("keeps file drawer rows compact and ellipsized on narrow screens", () => {
    expect(fileBrowserCss).toMatch(
      /\.file-name\s*\{[\s\S]*?white-space:\s*nowrap[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?flex:\s*1[\s\S]*?min-width:\s*0/,
    );
    expect(fileBrowserCss).toMatch(
      /\.file-size\s*\{[\s\S]*?flex-shrink:\s*0/,
    );
    expect(globalStyleCss).toMatch(
      /\.file-list\s*\{[\s\S]*?overflow-y:\s*auto/,
    );
    expect(globalStyleCss).toMatch(
      /\.file-sidebar-path\s*\{[\s\S]*?white-space:\s*nowrap[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?direction:\s*rtl/,
    );
  });

  it("stacks the provider channel editor and keeps key prefix hints readable on mobile", () => {
    expect(settingsConfigCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.provider-channel-editor\s*\{\s*grid-template-columns:\s*1fr/,
    );
    expect(settingsConfigCss).toMatch(
      /\.provider-channel-editor\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(settingsConfigCss).toMatch(
      /\.api-key-prefix-hint\s*\{[\s\S]*?color:\s*var\(--text-dim\)/,
    );
  });

  it("keeps the sidebar update pill styled and touch-safe on mobile", () => {
    expect(sidebarCss).toMatch(
      /\.sidebar-update-pill\s*\{[\s\S]*?border-radius:\s*var\(--radius-md\)[\s\S]*?background:\s*#0a84ff[\s\S]*?color:\s*#fff/,
    );
    expect(sidebarCss).toMatch(
      /\.sidebar-update-pill\[data-tone="warn"\]\s*\{[\s\S]*?background:\s*#ff9f0a/,
    );
    expect(sidebarCss).toMatch(
      /\.sidebar-footer\s*\{[\s\S]*?padding:\s*var\(--space-2\) var\(--space-3\)/,
    );
  });

  it("keeps the super-agent runtime board header and filters compact on mobile", () => {
    expect(superAgentRuntimeCss).toMatch(
      /\.runtime-title\s*\{[\s\S]*?flex:\s*1/,
    );
    expect(superAgentRuntimeCss).toMatch(
      /\.runtime-filters\s*\{[\s\S]*?display:\s*flex[\s\S]*?gap:\s*var\(--space-1\)/,
    );
    expect(superAgentRuntimeCss).toMatch(
      /\.runtime-filter\s*\{[\s\S]*?flex:\s*1[\s\S]*?border-radius:\s*var\(--radius-md\)/,
    );
    expect(superAgentRuntimeCss).toMatch(
      /\.runtime-task-list\s*\{[\s\S]*?overflow-y:\s*auto/,
    );
  });

  it("keeps the mobile model dropdown visible above the navigation bar", () => {
    expect(mobileCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.composer-toolbar\s*\.model-dropdown-menu\s*\{[\s\S]*?position:\s*fixed[\s\S]*?bottom:\s*calc\([\s\S]*?var\(--mobile-nav-height\)/,
    );
    expect(mobileCss).not.toMatch(
      /\.composer-toolbar\s*\.model-dropdown-menu\s*\{[\s\S]*?bottom:\s*calc\(100% \+ var\(--space-2\)\)/,
    );
    expect(headerCss).toMatch(
      /\.model-dropdown-item\s*\{[\s\S]*?padding:\s*var\(--space-2\) var\(--space-3\)/,
    );
  });

  it("keeps anchored popovers on positioned containing blocks (no viewport-relative 100% offsets)", () => {
    // Composer card and input area stay positioned so absolute popovers resolve
    // against them instead of the viewport.
    expect(composerCss).toMatch(/\.composer-card\s*\{[\s\S]*?position:\s*relative/);
    expect(composerCss).toMatch(
      /\.input-area\s*\{[\s\S]*?position:\s*absolute[\s\S]*?bottom:\s*0[\s\S]*?left:\s*0[\s\S]*?right:\s*0/,
    );
    // Todo mirror and slash menu stay anchored popovers (absolute, not fixed).
    expect(rpivTodoCss).toMatch(
      /\.rpiv-todo-panel\s*\{[\s\S]*?position:\s*absolute[\s\S]*?bottom:\s*calc\(100% \+ var\(--space-2\)\)/,
    );
    expect(slashMenuCss).toMatch(
      /\.skill-slash-menu\s*\{[\s\S]*?position:\s*absolute[\s\S]*?bottom:\s*calc\(100% \+ 10px\)/,
    );
    // Model dropdown anchor stays relative so the desktop menu resolves against
    // the button instead of the viewport.
    expect(headerCss).toMatch(/\.model-dropdown\s*\{[\s\S]*?position:\s*relative/);
    // No fixed element in mobile.css may offset itself with viewport-relative
    // calc(100% ...) — the round-79 model-menu bug class.
    expect(mobileCss).not.toMatch(/position:\s*fixed[\s\S]{0,300}?(?:top|bottom|left|right):\s*calc\(100%/);
    // The token-usage / open-app header cluster stays hidden on phones; if it is
    // ever shown again, context-viz needs a viewport-capped width first.
    expect(mobileCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.header-right\s*\{\s*display:\s*none\s*!important;[\s\S]*?\}/,
    );
  });

  it("keeps remaining fixed overlays touch-safe and centers dialogs without offset animations", () => {
    expect(sessionSidebarCss).toMatch(
      /@media \(max-width: 768px\), \(max-height: 520px\) and \(pointer: coarse\)[\s\S]*?\.sidebar-confirm-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[\s\S]*?\.sidebar-confirm-actions\s*button\s*\{[\s\S]*?min-height:\s*var\(--control-height-lg\)/,
    );
    expect(dialogCss).toMatch(/\.dialog\s*\{[\s\S]*?animation:\s*dialogIn/);
    expect(dialogCss).not.toMatch(/\.dialog\s*\{[\s\S]*?animation:\s*sheetIn/);
    expect(dialogCss).toMatch(/@keyframes\s+dialogIn[\s\S]*?to\s*\{[\s\S]*?transform:\s*none/);
  });

  it("anchors mobile bottom sheets above the software keyboard when it is open", () => {
    expect(mobileCss).toMatch(
      /body\.mobile-keyboard-open \.composer-image-picker:not\(\[hidden\]\)[\s\S]*?bottom:\s*calc\([\s\S]*?var\(--mobile-visual-viewport-bottom/,
    );
  });

  it("floats the right side panel over the main column at every width", () => {
    expect(globalStyleCss).toMatch(
      /\.app-side-panel\s*\{[\s\S]*?position:\s*absolute[\s\S]*?right:\s*0[\s\S]*?bottom:\s*0/,
    );
    expect(globalStyleCss).toMatch(
      /\.app-side-panel\.collapsed\s*\{[\s\S]*?transform:\s*translateX\(100%\)/,
    );
  });

  it("keeps the plugin activity bar full-height so system actions pin to the bottom", () => {
    expect(pluginShellCss).toMatch(
      /\.plugin-activity-bar\s*\{[\s\S]*?height:\s*100%/,
    );
  });

  it("mounts plugin apps through a layout-transparent wrapper", () => {
    expect(pluginShellCss).toMatch(
      /\.plugin-app-mount\s*\{\s*display:\s*contents/,
    );
  });

  it("keeps a maskable launcher icon wired into the PWA manifest", () => {
    expect(manifest).toMatch(/"purpose":\s*"maskable"/);
    expect(manifest).toContain('"src": "icons/app-maskable-512.png"');
    expect(manifest).toContain('"display": "standalone"');
    expect(manifest).toContain('"share_target"');
  });
});
