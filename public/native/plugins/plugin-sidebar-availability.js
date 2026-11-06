// An external main View without a sidebar must not expose an empty drawer.
export function createPluginSidebarAvailability(sidebar) {
  const originalHidden = sidebar.hidden;
  return {
    sync(plugin) {
      const external = plugin?.origin === "developer" || plugin?.origin === "signed";
      sidebar.hidden = plugin?.id === "com.zicode.browser" || (external && !(plugin.views ?? []).some(view => view.location === "sidebar"));
      return !sidebar.hidden;
    },
    destroy() { sidebar.hidden = originalHidden; },
  };
}
