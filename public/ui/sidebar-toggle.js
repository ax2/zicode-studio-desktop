import { setupMobileHistoryLayer } from "../native/utils/mobile-history-layer.js";

export const MOBILE_SHELL_QUERY = "(max-width: 768px), (max-height: 520px) and (pointer: coarse)";

export function setupSidebarToggle({ mobileBreakpoint = 768 } = {}) {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("sidebar-toggle");
  const overlay = document.getElementById("sidebar-overlay");
  if (!sidebar || !toggle) return null;

  const mobileMedia =
    mobileBreakpoint === 768 && typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_SHELL_QUERY)
      : null;
  const isMobile = () => mobileMedia?.matches ?? window.innerWidth <= mobileBreakpoint;
  let mobile = isMobile();

  const sidebarAvailable = () => !sidebar.hidden && window.getComputedStyle(sidebar).display !== "none";
  let drawerHistory = null;
  const setCollapsed = (collapsed, { fromHistory = false, discardHistory = false } = {}) => {
    // A hidden function area must never leave a standalone backdrop over the main view.
    collapsed = collapsed || (isMobile() && !sidebarAvailable());
    const changed = sidebar.classList.contains("collapsed") !== collapsed;
    if (changed) sidebar.classList.toggle("collapsed", collapsed);
    overlay?.classList.toggle("visible", !collapsed && isMobile());
    overlay?.setAttribute("aria-hidden", String(collapsed || !isMobile()));
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (!isMobile()) return;
    if (!collapsed && changed) drawerHistory?.enter();
    else if (collapsed && !fromHistory && (changed || discardHistory))
      drawerHistory?.leave({ replace: discardHistory });
  };

  drawerHistory = setupMobileHistoryLayer({
    id: "function-area",
    isActive: () => isMobile() && !sidebar.classList.contains("collapsed"),
    onBack: () => setCollapsed(true, { fromHistory: true }),
  });

  const syncAvailability = () => {
    const available = sidebarAvailable();
    toggle.hidden = !available;
    toggle.disabled = !available;
    if (
      isMobile() &&
      (!available ||
        (sidebar.classList.contains("collapsed") && overlay?.classList.contains("visible")))
    ) setCollapsed(true, { discardHistory: true });
  };
  if (mobile) setCollapsed(true, { discardHistory: true });
  syncAvailability();

  const handleToggle = () => setCollapsed(!sidebar.classList.contains("collapsed"));
  const handleOverlay = () => setCollapsed(true);
  const handleRequest = (event) => {
    if (!isMobile()) return;
    setCollapsed(event.detail?.open === false);
  };
  const handleSidebarAction = (event) => {
    if (!isMobile()) return;
    const target = event.target?.closest?.("button, a[href]");
    if (!target || target.closest(".plugin-sidebar-view-header, summary")) return;
    if (
      target.matches(
        "#session-search-clear, #refresh-sessions-btn, #workspace-switcher-btn",
      ) ||
      target.closest(
        "#workspace-switcher-menu, .session-more-btn, .session-archive-btn, .project-more-btn, .archived-delete-all-btn",
      )
    )
      return;
    queueMicrotask(() => setCollapsed(true));
  };
  const handleKeydown = (event) => {
    if (
      event.defaultPrevented ||
      event.key !== "Escape" ||
      !isMobile() ||
      sidebar.classList.contains("collapsed")
    )
      return;
    setCollapsed(true);
    toggle.focus({ preventScroll: true });
  };
  const handleResize = () => {
    const nextMobile = isMobile();
    if (nextMobile && !mobile) setCollapsed(true, { discardHistory: true });
    if (!nextMobile && mobile) setCollapsed(false, { discardHistory: true });
    if (!nextMobile) overlay?.classList.remove("visible");
    mobile = nextMobile;
    syncAvailability();
  };

  toggle.addEventListener("click", handleToggle);
  overlay?.addEventListener("click", handleOverlay);
  sidebar.addEventListener("click", handleSidebarAction);
  document.addEventListener("zicode:function-area-request", handleRequest);
  document.addEventListener("zicode:active-plugin-changed", syncAvailability);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", handleResize);
  mobileMedia?.addEventListener?.("change", handleResize);
  // Catalog refreshes and view lifecycle updates can hide the sidebar without navigation.
  const availabilityObserver = new MutationObserver(syncAvailability);
  availabilityObserver.observe(sidebar, { attributes: true, attributeFilter: ["hidden", "style", "class"] });

  return {
    setCollapsed,
    destroy() {
      availabilityObserver.disconnect();
      toggle.removeEventListener("click", handleToggle);
      overlay?.removeEventListener("click", handleOverlay);
      sidebar.removeEventListener("click", handleSidebarAction);
      document.removeEventListener("zicode:function-area-request", handleRequest);
      document.removeEventListener("zicode:active-plugin-changed", syncAvailability);
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("resize", handleResize);
      mobileMedia?.removeEventListener?.("change", handleResize);
      drawerHistory?.dispose();
    },
  };
}
