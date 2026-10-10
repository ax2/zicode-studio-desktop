import { expect, it } from "vitest";
import { nextEnabledIndex, pageEnabledIndex } from "./palette-navigation";

it("pages over eligible rows without wrapping at either edge", () => {
  const commands = Array.from({ length: 30 }, (_, index) => ({ disabled: index % 2 === 0 }));
  expect(pageEnabledIndex(commands, 1, 1)).toBe(21);
  expect(pageEnabledIndex(commands, 21, -1)).toBe(1);
  expect(pageEnabledIndex(commands, 21, 1)).toBe(29);
  expect(pageEnabledIndex(commands, 29, 1)).toBe(29);
  expect(pageEnabledIndex(commands, 1, -1)).toBe(1);
  expect(pageEnabledIndex([], -1, 1)).toBe(-1);
  expect(pageEnabledIndex([{ disabled: true }], -1, -1)).toBe(-1);
});

it("skips disabled commands in both directions and handles no eligible commands", () => {
  expect(nextEnabledIndex([], 0, 1)).toBe(-1);
  expect(nextEnabledIndex([{ disabled: true }], -1, 1)).toBe(-1);
  const commands = [{}, { disabled: true }, {}];
  expect(nextEnabledIndex(commands, 0, 1)).toBe(2);
  expect(nextEnabledIndex(commands, 2, -1)).toBe(0);
  expect(nextEnabledIndex(commands, 2, 1)).toBe(0);
  expect(nextEnabledIndex(commands, -1, -1)).toBe(2);
});

it("wraps a thousand-row catalog without selecting its disabled first entry", () => {
  const commands = Array.from({ length: 1000 }, (_, index) => ({ disabled: index % 7 === 0 }));
  expect(nextEnabledIndex(commands, 999, 1)).toBe(1);
  expect(nextEnabledIndex(commands, 1, -1)).toBe(999);
});
