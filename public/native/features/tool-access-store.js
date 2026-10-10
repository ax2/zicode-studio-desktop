// Desktop Host persistence. Never store tool inputs, labels, tokens or schemas.
function validate(access) {
  const validId = (id) => typeof id === "string" && id.length > 0 && new TextEncoder().encode(id).length <= 256 && id.trim() === id && !Array.from(id).some(char => char.codePointAt(0) <= 31 || (char.codePointAt(0) >= 127 && char.codePointAt(0) <= 159));
  if (access?.schemaVersion !== 1 || !Number.isSafeInteger(access.revision) || access.revision < 0 ||
      !Array.isArray(access.favorites) || access.favorites.length > 512 || !access.favorites.every(validId) ||
      new Set(access.favorites).size !== access.favorites.length || !Array.isArray(access.recent) || access.recent.length > 40 ||
      !access.recent.every(entry => validId(entry.id) && Number.isSafeInteger(entry.usedAt) && entry.usedAt > 0) ||
      new Set(access.recent.map(entry => entry.id)).size !== access.recent.length) {
    throw new Error("tool_access_incompatible");
  }
  return access;
}

export function createToolAccessStore(control) {
  return {
    read: async scope => validate((await control.toolAccess(scope)).access),
    mutate: async (scope, mutation) => validate((await control.toolAccess(scope, mutation)).access),
  };
}
