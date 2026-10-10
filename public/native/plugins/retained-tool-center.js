// One retained React surface per shell; navigation detaches its DOM without losing active calls.
export function createRetainedToolCenter(mount) {
  let view = null;
  let element = null;
  let scopeKey = null;
  const key = scope => JSON.stringify([scope?.sceneId ?? null, scope?.workspaceId ?? null]);
  function destroy() {
    view?.destroy();
    view = null; element = null; scopeKey = null;
  }
  return {
    setScope(scope) { if (view && scopeKey !== key(scope)) destroy(); },
    show(container, props) {
      if (view && scopeKey !== key(props.scope)) destroy();
      if (!view) {
        element = document.createElement("div");
        scopeKey = key(props.scope);
        container.append(element);
        view = mount(element, props);
      } else {
        container.append(element);
        view.update(props);
      }
    },
    openTool(tool, revision) { view?.openTool(tool, revision); },
    destroy,
  };
}
