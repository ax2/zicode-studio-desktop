// Full-width core apps and external Views without navigation must not expose an empty drawer.
export function createPluginSidebarAvailability(sidebar) {
  const originalHidden = sidebar.hidden;
  return {
    sync(plugin) {
      const external = plugin?.origin === "developer" || plugin?.origin === "signed";
      const fullWidth = plugin?.id === "com.zicode.browser" || plugin?.id === "com.zicode.visual-assets";
      sidebar.hidden = fullWidth || (external && !(plugin.views ?? []).some(view => view.location === "sidebar"));
      return !sidebar.hidden;
    },
    destroy() { sidebar.hidden = originalHidden; },
  };
}
