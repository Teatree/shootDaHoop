import { BALANCE } from "./config";

// The ball budget, ENERGY-style (owner redesign 2026-07-17; replaced
// the daily UTC-midnight refill): a cap of ballCap balls, one
// regenerating every regenMinutes. The regen clock starts the moment a
// player throws FROM FULL - a full rack runs no timer. Returning
// players earn every ball the clock owed them (AFK earnings), capped.
//
// In multiplayer it is SERVER-authoritative - the client may display
// and locally simulate the count; it never decides it. Offline the
// LocalBackend enforces the same rules against a localStorage-persisted
// record, so practice and live play spend balls identically.
//
// State: { balls, anchorMs }. anchorMs marks the start of the CURRENT
// regen period and is only meaningful while balls < cap - the ONLY
// transition out of full is consumeThrow, which re-anchors to "now",
// so a stale anchor at cap can never leak time.

export interface BudgetFields {
  balls: number;
  anchorMs: number; // epoch ms - start of the regen period in progress
}

const REGEN_MS = () => BALANCE.budget.regenMinutes * 60_000;

/**
 * Bank every ball the clock has earned since the anchor. Idempotent -
 * safe to run on every read; unpersisted gains recompute identically
 * from the stored anchor after a restart.
 */
function refresh(p: BudgetFields, nowMs: number) {
  const cap = BALANCE.budget.ballCap;
  if (p.balls >= cap) {
    p.balls = cap;
    return;
  }
  // a clock stepped backwards (NTP, suspend) must never mint or eat
  // balls - clamp the anchor, floor the gain at zero
  p.anchorMs = Math.min(p.anchorMs, nowMs);
  const gained = Math.max(0, Math.floor((nowMs - p.anchorMs) / REGEN_MS()));
  p.balls = Math.min(cap, p.balls + gained);
  if (p.balls < cap) p.anchorMs += gained * REGEN_MS(); // keep partial progress
}

export function remainingThrows(p: BudgetFields, now: Date): number {
  refresh(p, now.getTime());
  return p.balls;
}

/** Consume one ball; returns false (and consumes nothing) when empty. */
export function consumeThrow(p: BudgetFields, now: Date): boolean {
  refresh(p, now.getTime());
  if (p.balls <= 0) return false;
  // AFTER refresh on purpose: a rack the refresh just refilled counts
  // as full - this throw is the one that starts the clock
  const wasFull = p.balls >= BALANCE.budget.ballCap;
  p.balls -= 1;
  if (wasFull) p.anchorMs = now.getTime();
  return true;
}

/**
 * Give one ball back - a ball that hit the teleport orb or was caught
 * is "the same ball". The anchor is untouched: progress toward the
 * NEXT ball survives the refund. At cap the refund silently drops
 * (regen already replaced it; a full rack can't get fuller).
 */
export function refundThrow(p: BudgetFields, now: Date) {
  refresh(p, now.getTime());
  p.balls = Math.min(BALANCE.budget.ballCap, p.balls + 1);
}

/** Milliseconds until the next ball lands; null at cap (no clock runs). */
export function msToNextBall(p: BudgetFields, now: Date): number | null {
  refresh(p, now.getTime());
  if (p.balls >= BALANCE.budget.ballCap) return null;
  return Math.max(0, REGEN_MS() - (now.getTime() - p.anchorMs));
}

/**
 * The hydration gate: profiles from the daily-budget era (fields
 * throwsUsedToday/lastThrowDayUTC), missing records, and corrupt ones
 * (non-finite numbers would NaN-poison every check - consume would
 * never fail again) all become a fresh full rack. Idempotent; every
 * hydration site (server budgetFor, offline loadBudget) runs it.
 */
export function sanitizeBudget(b: unknown, now: Date): BudgetFields {
  const maybe = b as Partial<BudgetFields> | null | undefined;
  if (
    maybe &&
    Number.isFinite(maybe.balls) &&
    Number.isFinite(maybe.anchorMs)
  ) {
    return maybe as BudgetFields;
  }
  return { balls: BALANCE.budget.ballCap, anchorMs: now.getTime() };
}
