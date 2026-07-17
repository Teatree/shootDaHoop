import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/shared/config";
import {
  consumeThrow,
  msToNextBall,
  refundThrow,
  remainingThrows,
  sanitizeBudget,
  type BudgetFields,
} from "../src/shared/budget";

// The energy budget (owner redesign 2026-07-17): cap balls, one back
// every regenMinutes, the clock starting on the throw FROM FULL, AFK
// earnings on return. Every subtlety here shipped with a bug attached
// in some mobile game once - pin them all.

const CAP = BALANCE.budget.ballCap;
const REGEN_MS = BALANCE.budget.regenMinutes * 60_000;
const T0 = Date.UTC(2026, 6, 17, 12, 0, 0);
const at = (ms: number) => new Date(T0 + ms);
const full = (): BudgetFields => ({ balls: CAP, anchorMs: 0 });

describe("energy ball budget", () => {
  it("a fresh rack is full and runs NO clock", () => {
    const p = full();
    expect(remainingThrows(p, at(0))).toBe(CAP);
    expect(msToNextBall(p, at(0))).toBeNull();
  });

  it("the regen clock starts on the throw from full", () => {
    const p = full();
    expect(consumeThrow(p, at(0))).toBe(true);
    expect(remainingThrows(p, at(0))).toBe(CAP - 1);
    expect(msToNextBall(p, at(0))).toBe(REGEN_MS);
    // one full period later the ball is back
    expect(remainingThrows(p, at(REGEN_MS))).toBe(CAP);
    expect(msToNextBall(p, at(REGEN_MS))).toBeNull();
  });

  it("sitting at full for hours banks nothing extra", () => {
    const p = full();
    consumeThrow(p, at(0)); // clock starts
    // refilled at +REGEN; hours later still exactly at cap, and the
    // NEXT throw from full restarts the clock at ITS moment
    expect(remainingThrows(p, at(10 * REGEN_MS))).toBe(CAP);
    consumeThrow(p, at(10 * REGEN_MS));
    expect(msToNextBall(p, at(10 * REGEN_MS))).toBe(REGEN_MS);
  });

  it("AFK earnings: every ball the clock owed, capped", () => {
    const p = full();
    for (let i = 0; i < CAP; i++) consumeThrow(p, at(0)); // empty at T0
    expect(remainingThrows(p, at(0))).toBe(0);
    // 3.5 periods later: 3 whole balls earned, half a period of progress
    expect(remainingThrows(p, at(3.5 * REGEN_MS))).toBe(3);
    expect(msToNextBall(p, at(3.5 * REGEN_MS))).toBe(REGEN_MS / 2);
    // a week away: capped, clock idle
    expect(remainingThrows(p, at(7 * 24 * 60 * REGEN_MS))).toBe(CAP);
    expect(msToNextBall(p, at(7 * 24 * 60 * REGEN_MS))).toBeNull();
  });

  it("a throw from a refresh-refilled rack counts as from-full", () => {
    const p = full();
    consumeThrow(p, at(0)); // clock starts
    // the rack silently refilled at +REGEN; throwing at +5 REGEN must
    // anchor the new clock at +5 REGEN, not carry the stale anchor
    consumeThrow(p, at(5 * REGEN_MS));
    expect(msToNextBall(p, at(5 * REGEN_MS))).toBe(REGEN_MS);
  });

  it("consuming below full does not touch the running clock", () => {
    const p = full();
    consumeThrow(p, at(0));
    consumeThrow(p, at(REGEN_MS / 2)); // second throw, clock unmoved
    expect(remainingThrows(p, at(REGEN_MS / 2))).toBe(CAP - 2);
    expect(msToNextBall(p, at(REGEN_MS / 2))).toBe(REGEN_MS / 2);
  });

  it("refunds give the ball back and preserve regen progress", () => {
    const p = full();
    consumeThrow(p, at(0));
    consumeThrow(p, at(0));
    refundThrow(p, at(REGEN_MS * 0.7)); // catch/orb at 70% progress
    expect(remainingThrows(p, at(REGEN_MS * 0.7))).toBe(CAP - 1);
    expect(msToNextBall(p, at(REGEN_MS * 0.7))).toBe(REGEN_MS * 0.3);
  });

  it("a refund at the cap silently drops", () => {
    const p = full();
    refundThrow(p, at(0));
    expect(remainingThrows(p, at(0))).toBe(CAP);
  });

  it("consume refuses when empty", () => {
    const p = full();
    for (let i = 0; i < CAP; i++) expect(consumeThrow(p, at(0))).toBe(true);
    expect(consumeThrow(p, at(0))).toBe(false);
    expect(remainingThrows(p, at(0))).toBe(0);
  });

  it("a clock stepping backwards never mints or eats balls", () => {
    const p = full();
    consumeThrow(p, at(REGEN_MS)); // anchor at +REGEN
    // NTP yanks the clock back before the anchor
    expect(remainingThrows(p, at(0))).toBe(CAP - 1);
    // and forward again - regen resumes without double-counting
    expect(remainingThrows(p, at(2 * REGEN_MS))).toBe(CAP);
  });
});

describe("sanitizeBudget - the hydration gate", () => {
  const NOW = at(0);

  it("passes a valid record through unchanged", () => {
    const p = { balls: 2, anchorMs: T0 - 1000 };
    expect(sanitizeBudget(p, NOW)).toBe(p);
  });

  it("migrates daily-era records to a fresh full rack", () => {
    const old = { throwsUsedToday: 3, lastThrowDayUTC: "2026-07-16" };
    const p = sanitizeBudget(old, NOW);
    expect(p).toEqual({ balls: CAP, anchorMs: T0 });
  });

  // NaN poisoning would make consume never fail - guard every field
  it("replaces missing, partial and NaN-poisoned records", () => {
    for (const bad of [null, undefined, {}, { balls: NaN, anchorMs: 0 }, { balls: 3 }]) {
      const p = sanitizeBudget(bad, NOW);
      expect(p.balls).toBe(CAP);
      expect(Number.isFinite(p.anchorMs)).toBe(true);
    }
  });
});
