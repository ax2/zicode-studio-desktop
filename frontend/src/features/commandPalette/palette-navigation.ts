/** Disabled entries stay visible but cannot run. */
export function nextEnabledIndex(
  commands: readonly { disabled?: boolean }[],
  current: number,
  direction: 1 | -1,
): number {
  const count = commands.length;
  if (count === 0) return -1;
  let index = current >= 0 && current < count ? current : direction === 1 ? -1 : 0;
  for (let attempt = 0; attempt < count; attempt++) {
    index = (index + direction + count) % count;
    if (!commands[index].disabled) return index;
  }
  return -1;
}

/** Page navigation stops at the edge; arrow navigation alone wraps. */
export function pageEnabledIndex(
  commands: readonly { disabled?: boolean }[],
  current: number,
  direction: 1 | -1,
  steps = 10,
): number {
  const eligible = commands.flatMap((command, index) => command.disabled ? [] : [index]);
  if (!eligible.length) return -1;
  const position = eligible.indexOf(current);
  if (position < 0) return direction === 1 ? eligible[0] : eligible[eligible.length - 1];
  return eligible[Math.max(0, Math.min(eligible.length - 1, position + direction * steps))];
}
