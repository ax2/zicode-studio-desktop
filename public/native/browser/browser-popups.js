// Native WebView2 supplies gesture/policy decisions. Do not infer them from page messages.
export function createBrowserPopups({ currentSource, open, blocked, cancel = () => {} }) {
  const pending = new Set();
  return async payload => {
    const current = currentSource(payload.tab);
    try {
      if (!current || pending.has(payload.tab)) return;
      if (!payload.userInitiated || !payload.allowed) { blocked(); return; }
      pending.add(payload.tab);
      try {
        await open({ url: payload.url, title: payload.url }, {
          after: payload.tab, current, background: payload.background === true, popupRequest: payload.request,
        });
      } finally { pending.delete(payload.tab); }
    } finally {
      if (payload.request) await cancel(payload.request);
    }
  };
}

export function insertBrowserLinkedTab(tabs, source, tab) {
  const index = tabs.findIndex(item => item.id === source);
  if (index < 0) throw new Error("Browser tab is no longer available");
  const next = [...tabs]; next.splice(index + 1, 0, tab); return next;
}
