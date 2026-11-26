export function createBookmarkFolderIndex(folders) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const paths = new Map();
  return {
    path(id) {
      if (!id) return [];
      if (paths.has(id)) return paths.get(id);
      const path = [], seen = new Set();
      let cursor = id;
      while (cursor) {
        const folder = byId.get(cursor);
        if (!folder || seen.has(cursor)) return [];
        path.push(folder);
        seen.add(cursor);
        cursor = folder.parentId;
      }
      path.reverse();
      paths.set(id, path);
      return path;
    },
  };
}
export function folderOptions(folders, excludedId = null) {
  const index = createBookmarkFolderIndex(folders);
  return folders.flatMap(folder => {
    const path = index.path(folder.id);
    if (!path.length || path.some(item => item.id === excludedId)) return [];
    return [{ id: folder.id, title: path.map(item => item.title).join(" / ") }];
  }).sort((a, b) => a.title.localeCompare(b.title));
}
export function orderBookmarkRows(left, right) {
  return (left.position ?? -1) - (right.position ?? -1);
}

export function nextBookmarkPosition(library, parentId) {
  let position = 0;
  for (const folder of library.folders) {
    if (folder.parentId === parentId) position = Math.max(position, (folder.position ?? -1) + 1);
  }
  for (const bookmark of library.bookmarks) {
    if (bookmark.folderId === parentId) position = Math.max(position, (bookmark.position ?? -1) + 1);
  }
  return position;
}

export function removeBookmarkFolder(library, id) {
  const folder = library.folders.find(entry => entry.id === id);
  if (!folder) throw Error("Bookmark folder is unavailable");
  const moved = [
    ...library.folders.filter(entry => entry.parentId === id),
    ...library.bookmarks.filter(entry => entry.folderId === id),
  ].sort(orderBookmarkRows);
  const first = nextBookmarkPosition(library, folder.parentId);
  const positions = new Map(moved.map((entry, index) => [entry.id, first + index]));
  return {
    folders: library.folders.filter(entry => entry.id !== id).map(entry => (
      entry.parentId === id ? { ...entry, parentId: folder.parentId, position: positions.get(entry.id) } : entry
    )),
    bookmarks: library.bookmarks.map(entry => (
      entry.folderId === id ? { ...entry, folderId: folder.parentId, position: positions.get(entry.id) } : entry
    )),
  };
}
