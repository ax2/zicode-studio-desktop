// Older/mock readers may omit a revision. New servers reject such writes explicitly.
export function taskWriteParams(tasks, revision) {
  return typeof revision === "string" ? { tasks, revision } : { tasks };
}
