import { t } from "../../shared/i18n";
import { QuickToolLinks } from "../quickTools/QuickToolLinks";

export function CompactWelcome({ openApp, enabledIds }: { openApp?: (id: string) => void; enabledIds?: string[] | null }) {
  const apps = [
    { id: "com.zicode.notes", title: "Notes", icon: "📝" },
    { id: "com.zicode.projects", title: "Projects", icon: "📁" },
    { id: "com.zicode.tasks", title: "Tasks", icon: "☑" },
    { id: "core.tools", title: "All tools", icon: "⌘" },
  ].filter(app => app.id === "core.tools" || !enabledIds || enabledIds.includes(app.id));
  return <div className="welcome welcome-simple">
    <div className="welcome-hero"><h1>ZiCode Studio</h1><p className="hint">{t("Write a message below, open a note, or choose a tool.")}</p></div>
    <nav className="welcome-quick-actions" aria-label={t("Quick actions")}>
      {apps.map(app => <button key={app.id} className="welcome-quick-action" type="button" data-quick-action={app.id}
        onClick={() => openApp?.(app.id)}><span aria-hidden="true">{app.icon}</span><span>{t(app.title)}</span></button>)}
    </nav>
    <QuickToolLinks />
  </div>;
}
