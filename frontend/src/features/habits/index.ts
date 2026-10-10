import { createHabitsApp } from "./HabitsApp";
import type { HabitsOptions } from "./habitsStore";
import { HabitsHttpGateway } from "./habitsStore";

export { createHabitsApp } from "./HabitsApp";
export type { Habit, HabitEntry } from "./habitsLogic";
export { currentStreak, lastDates, toDateKey } from "./habitsLogic";
export type { HabitsOptions } from "./habitsStore";
export { HabitsHttpGateway } from "./habitsStore";

export function setupHabitsApp(options: HabitsOptions) {
  return createHabitsApp({
    gateway: options.gateway ?? new HabitsHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
  });
}
