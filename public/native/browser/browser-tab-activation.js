// Keep the current document visible until the new selection is durably saved.
// Preparation creates hidden views; commit alone updates UI and presentation.
export function createBrowserTabActivation({ getTabs, getActive, prepare, persist, commit, discard }) {
  return {
    async select(id) {
      const tab = getTabs().find(tab => tab.id === id);
      if (!tab) return;
      if (id === getActive()) return commit(getTabs(), id);
      await prepare(tab);
      const next = getTabs();
      await persist(next, id);
      await commit(next, id);
    },
    async add(tab, { insert = (tabs, item) => [...tabs, item], current = () => true, background = false } = {}) {
      if (!current()) return;
      let next, id;
      try {
        await prepare(tab);
        if (current()) {
          next = insert(getTabs(), tab);
          id = background ? getActive() : tab.id;
          await persist(next, id);
        }
      } catch (error) {
        await discard(tab.id);
        throw error;
      }
      if (!next) return discard(tab.id);
      // A presentation failure must not destroy an already committed tab.
      await commit(next, id, background);
    },
  };
}
