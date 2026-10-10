export function commandWindow(count: number, top: number, height: number, row: number) {
  const scrollTop = Math.max(0, Math.min(top, Math.max(0, count * row - height)));
  const start = Math.max(0, Math.floor(scrollTop / row) - 4);
  const end = Math.min(count, Math.ceil((scrollTop + height) / row) + 4);
  return { start, end, before: start * row, after: (count - end) * row };
}

export function revealCommand(index: number, top: number, height: number, row: number) {
  if (index < 0) return top;
  if (index * row < top) return index * row;
  if ((index + 1) * row > top + height) return Math.max(0, (index + 1) * row - height);
  return top;
}
