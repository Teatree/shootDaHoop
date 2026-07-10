import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/shared/config";
import {
  consumeThrow,
  refundThrow,
  remainingThrows,
  type BudgetFields,
} from "./budget";

const NOON = new Date("2026-07-09T12:00:00Z");
const LATER_SAME_DAY = new Date("2026-07-09T23:59:59Z");
const NEXT_DAY = new Date("2026-07-10T00:00:01Z");

const fresh = (): BudgetFields => ({
  throwsUsedToday: 0,
  lastThrowDayUTC: "",
});

describe("daily throw budget (UTC-midnight reset)", () => {
  it("grants the full allowance to a fresh profile", () => {
    expect(remainingThrows(fresh(), NOON)).toBe(BALANCE.budget.throwsPerDay);
  });

  it("counts down within a day and refuses when exhausted", () => {
    const p = fresh();
    for (let i = 0; i < BALANCE.budget.throwsPerDay; i++) {
      expect(consumeThrow(p, NOON)).toBe(true);
    }
    expect(consumeThrow(p, LATER_SAME_DAY)).toBe(false);
    expect(remainingThrows(p, LATER_SAME_DAY)).toBe(0);
  });

  it("resets at UTC midnight, not a rolling 24h window", () => {
    const p = fresh();
    for (let i = 0; i < BALANCE.budget.throwsPerDay; i++) consumeThrow(p, NOON);
    expect(remainingThrows(p, LATER_SAME_DAY)).toBe(0);
    expect(remainingThrows(p, NEXT_DAY)).toBe(BALANCE.budget.throwsPerDay);
    expect(consumeThrow(p, NEXT_DAY)).toBe(true);
  });

  it("never double-spends on the reset boundary", () => {
    const p = fresh();
    consumeThrow(p, NOON);
    expect(p.throwsUsedToday).toBe(1);
    remainingThrows(p, NOON); // reads must not consume
    expect(p.throwsUsedToday).toBe(1);
  });

  it("refunds an orb-hit throw (the slam is a free throw)", () => {
    const p = fresh();
    consumeThrow(p, NOON);
    consumeThrow(p, NOON);
    refundThrow(p, LATER_SAME_DAY);
    expect(remainingThrows(p, LATER_SAME_DAY)).toBe(
      BALANCE.budget.throwsPerDay - 1,
    );
  });

  it("refund is a no-op after the day rolls over, and never goes below 0", () => {
    const p = fresh();
    consumeThrow(p, NOON);
    refundThrow(p, NEXT_DAY); // new day already granted a fresh budget
    expect(p.throwsUsedToday).toBe(1);
    const q = fresh();
    q.lastThrowDayUTC = "2026-07-09";
    refundThrow(q, NOON);
    expect(q.throwsUsedToday).toBe(0);
  });
});
