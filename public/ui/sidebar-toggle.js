import { setupMobileHistoryLayer } from "../native/utils/mobile-history-layer.js";

export const MOBILE_SHELL_QUERY = "(max-width: 768px), (max-height: 520px) and (pointer: coarse)";

export function setupSidebarToggle({ mobileBreakpoint = 768 } = {}) {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("sidebar-toggle");
  const overlay = document.getElementById("sidebar-overlay");
  if (!sidebar || !toggle) return null;
  const main = toggle.closest(".main");

  const mobileMedia =
    mobileBreakpoint === 768 && typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_SHELL_QUERY)
      : null;
  const isMobile = () => mobileMedia?.matches ?? window.innerWidth <= mobileBreakpoint;
  let mobile = isMobile();

  const sidebarAvailable = () => !sidebar.hidden && window.getComputedStyle(sidebar).display !== "none";
  let drawerHistory = null;
  let drawerUrl;
  let ownsDrawerEntry = false;
  let pendingBackUrl;
  let ownsMainInert = false;
  const syncMainInteraction = () => {
    if (!main || !overlay) return;
    const covered = overlay.classList.contains("visible") &&
      window.getComputedStyle(overlay).display !== "none";
    if (covered && !main.hasAttribute("inert")) {
      if (main.contains(document.activeElement)) sidebar.focus({ preventScroll: true });
      main.setAttribute("inert", "");
      ownsMainInert = true;
    } else if (!covered && ownsMainInert) {
      main.removeAttribute("inert");
      ownsMainInert = false;
    }
  };
  const leaveDrawer = (replace) => {
    if (!pendingBackUrl && drawerHistory?.leave({ replace }) && !replace) {
      pendingBackUrl = drawerUrl;
    }
  };
  const setCollapsed = (collapsed, { fromHistory = false, discardHistory = false } = {}) => {
    // A hidden function area must never leave a standalone backdrop over the main view.
    collapsed = collapsed || (isMobile() && !sidebarAvailable());
    const changed = sidebar.classList.contains("collapsed") !== collapsed;
    if (changed) sidebar.classList.toggle("collapsed", collapsed);
    overlay?.classList.toggle("visible", !collapsed && isMobile());
    overlay?.setAttribute("aria-hidden", String(collapsed || !isMobile()));
    toggle.setAttribute("aria-expanded", String(!collapsed));
    syncMainInteraction();
    if (!isMobile()) return;
    if (!collapsed && changed) {
      drawerUrl = window.location.href;
      ownsDrawerEntry = !pendingBackUrl && drawerHistory?.enter() === true;
    } else if (collapsed && (changed || discardHistory)) {
      ownsDrawerEntry = false;
      if (!fromHistory) {
        // A selected destination can replace the drawer entry before it closes.
        leaveDrawer(discardHistory || window.location.href !== drawerUrl);
      }
    }
  };

  const dismissDrawer = (options) => {
    const focused = document.activeElement;
    setCollapsed(true, options);
    if (!toggle.disabled && (focused === document.body || sidebar.contains(focused))) {
      toggle.focus({ preventScroll: true });
    }
  };
  drawerHistory = setupMobileHistoryLayer({
    id: "function-area",
    isActive: () => !pendingBackUrl && isMobile() && !sidebar.classList.contains("collapsed"),
    onBack: () => dismissDrawer({ fromHistory: true }),
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
    else syncMainInteraction();
  };
  if (mobile) setCollapsed(true, { discardHistory: true });
  syncAvailability();

  const handleToggle = () => setCollapsed(!sidebar.classList.contains("collapsed"));
  const handleOverlay = () => dismissDrawer();
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
    queueMicrotask(() => dismissDrawer());
  };
  const handleKeydown = (event) => {
    if (
      event.defaultPrevented ||
      event.key !== "Escape" ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.target?.closest?.("dialog[open], [aria-modal='true']") ||
      !isMobile() ||
      sidebar.classList.contains("collapsed")
    )
      return;
    dismissDrawer();
  };
  const handleResize = () => {
    const nextMobile = isMobile();
    if (nextMobile && !mobile) setCollapsed(true, { discardHistory: true });
    if (!nextMobile && mobile) {
      if (ownsDrawerEntry && !sidebar.classList.contains("collapsed")) {
        // Only consume our own top entry. A new route or a nested layer owns its history.
        leaveDrawer(window.location.href !== drawerUrl);
        ownsDrawerEntry = false;
      }
      setCollapsed(false, { discardHistory: true });
    }
    if (!nextMobile) overlay?.classList.remove("visible");
    mobile = nextMobile;
    syncAvailability();
  };

  const handlePendingBack = () => {
    if (!pendingBackUrl) return;
    const previousUrl = pendingBackUrl;
    pendingBackUrl = undefined;
    if (!isMobile() || sidebar.classList.contains("collapsed")) return;
    // The drawer may have been opened again while its history entry was closing.
    if (drawerUrl === previousUrl && window.location.href === previousUrl) {
      ownsDrawerEntry = drawerHistory?.enter() === true;
    } else {
      setCollapsed(true, { fromHistory: true });
    }
  };

  toggle.addEventListener("click", handleToggle);
  overlay?.addEventListener("click", handleOverlay);
  sidebar.addEventListener("click", handleSidebarAction);
  document.addEventListener("zicode:function-area-request", handleRequest);
  document.addEventListener("zicode:active-plugin-changed", syncAvailability);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("popstate", handlePendingBack);
  window.addEventListener("resize", handleResize);
  mobileMedia?.addEventListener?.("change", handleResize);
  // Catalog refreshes and view lifecycle updates can hide the sidebar without navigation.
  const availabilityObserver = new MutationObserver(syncAvailability);
  availabilityObserver.observe(sidebar, { attributes: true, attributeFilter: ["hidden", "style", "class"] });

  return {
    setCollapsed,
    destroy() {
      availabilityObserver.disconnect();
      if (ownsMainInert) main.removeAttribute("inert");
      toggle.removeEventListener("click", handleToggle);
      overlay?.removeEventListener("click", handleOverlay);
      sidebar.removeEventListener("click", handleSidebarAction);
      document.removeEventListener("zicode:function-area-request", handleRequest);
      document.removeEventListener("zicode:active-plugin-changed", syncAvailability);
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("popstate", handlePendingBack);
      window.removeEventListener("resize", handleResize);
      mobileMedia?.removeEventListener?.("change", handleResize);
      drawerHistory?.dispose();
    },
  };
}
