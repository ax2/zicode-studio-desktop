import { expect, it } from "vitest";
import { commandWindow, revealCommand } from "./command-window";

it("bounds rows while preserving total height and revealing logical first/last selections", () => {
  for (const count of [0, 1, 100, 500, 1000, 10000]) {
    for (let step = 0; step <= 100; step++) {
      const range = commandWindow(count, count * 56 * step / 100, 280, 56);
      expect(range.end - range.start).toBeLessThanOrEqual(14);
      expect(range.before + (range.end - range.start) * 56 + range.after).toBe(count * 56);
      if (count) {
        const top = revealCommand(count - 1, 0, 280, 56);
        const last = commandWindow(count, top, 280, 56);
        expect(last.end).toBe(count);
        expect(revealCommand(0, top, 280, 56)).toBe(0);
      }
    }
  }
});
