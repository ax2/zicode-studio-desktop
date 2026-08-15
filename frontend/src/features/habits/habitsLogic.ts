// Shared helpers for the Habits feature.

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  color: string;
  createdAt: string;
  archived: boolean;
}

export interface HabitEntry {
  habitId: string;
  date: string;
  value: number;
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function lastDates(days: number, offsetDays = 0): string[] {
  const now = new Date();
  const result: string[] = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - index - offsetDays,
    );
    result.push(toDateKey(date));
  }
  return result;
}

export function currentStreak(entries: HabitEntry[], habitId: string): number {
  const done = new Set(
    entries.filter((entry) => entry.habitId === habitId).map((entry) => entry.date),
  );
  const today = new Date();
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!done.has(toDateKey(cursor))) {
    cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  }
  let streak = 0;
  while (done.has(toDateKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return streak;
}
