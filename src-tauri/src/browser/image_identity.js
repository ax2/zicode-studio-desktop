(() => {
  const state = globalThis.studioImageIdentity ??= { capture: '', expiresAt: 0, count: 0, entries: new Map() };
  const excluded = 'input,textarea,select,option,[contenteditable],[hidden],[inert],[aria-hidden="true"]';

  function rendered(image, owner) {
    if (!image.isConnected || !image.getClientRects().length ||
        image.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return false;
    for (let element = image; element;) {
      if (element.matches(excluded)) return false;
      if (element === owner.documentElement) return true;
      if (element.assignedSlot) {
        element = element.assignedSlot;
        continue;
      }
      const parent = element.parentElement;
      if (parent) {
        // Light children of an open host need an active slot. Assigned content replaces fallback.
        if (parent.shadowRoot || (parent.localName === 'slot' &&
            parent.getRootNode().host && parent.assignedNodes().length)) return false;
        element = parent;
        continue;
      }
      const root = element.getRootNode();
      element = root.mode === 'open' ? root.host : null;
    }
    return false;
  }

  function clear() {
    for (const entry of state.entries.values()) entry.dispose();
    state.entries.clear();
  }

  function begin(capture) {
    clear();
    state.capture = capture;
    state.expiresAt = performance.now() + 10 * 60 * 1000;
    state.count = 0;
    return (image, descriptor) => {
      if (state.capture !== capture || state.count >= 24 || !rendered(image, image.ownerDocument)) return null;
      const locator = `${capture}:${++state.count}`;
      const handlers = new AbortController();
      const observer = new MutationObserver(invalidate);
      function dispose() {
        observer.disconnect();
        handlers.abort();
      }
      function invalidate() {
        state.entries.delete(locator);
        dispose();
      }
      const attributes = ['src', 'srcset', 'sizes', 'crossorigin', 'referrerpolicy'];
      observer.observe(image, { attributeFilter: attributes });
      if (image.parentElement?.localName === 'picture') {
        observer.observe(image.parentElement, {
          attributeFilter: [...attributes, 'media', 'type'], childList: true, subtree: true,
        });
      }
      // Observe resource revisions even when the same element uses the same URL again.
      image.addEventListener('load', invalidate, { signal: handlers.signal });
      image.addEventListener('error', invalidate, { signal: handlers.signal });
      state.entries.set(locator, { image: new WeakRef(image), owner: new WeakRef(image.ownerDocument),
        descriptor, dispose, observer, invalidate });
      return locator;
    };
  }

  function resolve(approved, owner) {
    if (performance.now() >= state.expiresAt) {
      clear();
      return null;
    }
    const entry = state.entries.get(approved.locator);
    if (entry?.observer.takeRecords().length) {
      entry.invalidate();
      return null;
    }
    const image = entry?.image.deref();
    if (!image || entry.owner.deref() !== owner || image.ownerDocument !== owner ||
        !image.complete || image.currentSrc !== approved.url ||
        image.naturalWidth !== approved.width || image.naturalHeight !== approved.height ||
        [...image.alt.trim().slice(0, 320)].slice(0, 160).join('') !== approved.alt ||
        entry.descriptor.url !== approved.url || entry.descriptor.alt !== approved.alt ||
        entry.descriptor.width !== approved.width || entry.descriptor.height !== approved.height ||
        !rendered(image, owner)) return null;
    return image;
  }

  return { begin, resolve };
})
