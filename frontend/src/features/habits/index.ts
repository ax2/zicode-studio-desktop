import { createHabitsApp } from "./HabitsApp";
import type { HabitsOptions } from "./habitsStore";
import { HabitsHttpGateway } from "./habitsStore";

export { createHabitsApp } from "./HabitsApp";
export { HabitsHttpGateway } from "./habitsStore";
export type { HabitsOptions } from "./habitsStore";
export { currentStreak, lastDates, toDateKey } from "./habitsLogic";
export type { Habit, HabitEntry } from "./habitsLogic";

export function setupHabitsApp(options: HabitsOptions) {
  return createHabitsApp({
    gateway: options.gateway ?? new HabitsHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
  });
}
