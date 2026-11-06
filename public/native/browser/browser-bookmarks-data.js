export function folderOptions(folders, excludedId = null) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  return folders.flatMap(folder => {
    const names = [], seen = new Set(); let cursor = folder;
    while (cursor) {
      if (cursor.id === excludedId || seen.has(cursor.id)) return [];
      seen.add(cursor.id); names.unshift(cursor.title); cursor = byId.get(cursor.parentId);
    }
    return [{ id: folder.id, title: names.join(" / ") }];
  }).sort((a, b) => a.title.localeCompare(b.title));
}
export function removeBookmarkFolder(library, id) {
  const folder = library.folders.find(entry => entry.id === id);
  if (!folder) throw Error("Bookmark folder is unavailable");
  return {
    folders: library.folders.filter(entry => entry.id !== id).map(entry => entry.parentId === id ? { ...entry, parentId: folder.parentId } : entry),
    bookmarks: library.bookmarks.map(entry => entry.folderId === id ? { ...entry, folderId: folder.parentId } : entry),
  };
}
