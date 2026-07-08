import { BALANCE } from "../src/shared/config";

// The daily throw budget — SERVER-authoritative. The client may display
// the remaining count; it never decides it.
//
// DECIDE (recorded): the budget resets at UTC MIDNIGHT — simple, identical
// for every world, trivially explainable ("resets at midnight UTC") and
// testable. Rolling-24h windows and per-world local time were considered
// and rejected for this pass (rolling is opaque to players; per-world
// local time needs a timezone source we don't have until the bot platform
// provides one).

export interface BudgetFields {
  throwsUsedToday: number;
  lastThrowDayUTC: string; // "YYYY-MM-DD"
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Rolls the counter over if the UTC day changed since the last throw. */
function resetIfNewDay(p: BudgetFields, now: Date) {
  const today = utcDay(now);
  if (p.lastThrowDayUTC !== today) {
    p.throwsUsedToday = 0;
    p.lastThrowDayUTC = today;
  }
}

export function remainingThrows(p: BudgetFields, now: Date): number {
  resetIfNewDay(p, now);
  return Math.max(0, BALANCE.budget.throwsPerDay - p.throwsUsedToday);
}

/** Consume one throw; returns false (and consumes nothing) if exhausted. */
export function consumeThrow(p: BudgetFields, now: Date): boolean {
  resetIfNewDay(p, now);
  if (p.throwsUsedToday >= BALANCE.budget.throwsPerDay) return false;
  p.throwsUsedToday += 1;
  return true;
}
