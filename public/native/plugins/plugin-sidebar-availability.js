// Full-width core apps and external Views without navigation must not expose an empty drawer.
export function createPluginSidebarAvailability(sidebar) {
  const originalHidden = sidebar.hidden;
  return {
    sync(plugin) {
      const external = plugin?.origin === "developer" || plugin?.origin === "signed";
      const fullWidth = [
        "com.zicode.browser", "com.zicode.visual-assets", "com.zicode.mail",
        "com.zicode.translate", "com.zicode.documents", "com.zicode.clipboard",
        "com.zicode.graph", "com.zicode.habits", "com.zicode.ocr", "com.zicode.watch",
      ].includes(plugin?.id);
      sidebar.hidden = fullWidth || (external && !(plugin.views ?? []).some(view => view.location === "sidebar"));
      return !sidebar.hidden;
    },
    destroy() { sidebar.hidden = originalHidden; },
  };
}
