// Serialize native surface updates; async Tauri delivery must not reorder revisions.
export function createBrowserSurface(control) {
  let revision = 0;
  let tail = Promise.resolve();
  return {
    seed(value) { revision = Math.max(revision, value); },
    settled() { return tail; },
    send(request) {
      tail = tail.catch(() => {}).then(() => control({ ...request, revision: ++revision }));
      return tail;
    },
  };
}
