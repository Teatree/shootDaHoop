import { describe, expect, it } from "vitest";
import { BALANCE } from "./shared/config";
import {
  pointsForDistance,
  pointsForRims,
  rimPoints,
} from "./shared/scoring";

// The logistic distance curve (owner spec 2026-07-17). The exact values
// here are the sign-off tables from docs/scoring-curve.md - a curve
// tweak that silently moves the economy trips a test.

const EDGE = BALANCE.move.hoopStandoffM; // 5 m - the closest legal shot

describe("pointsForDistance - hoop 1 curve", () => {
  it("pays exactly basePts at the keep-out edge (the normal score point)", () => {
    expect(pointsForDistance(EDGE, 1)).toBe(100);
  });

  it("matches the sign-off table (mid 10 m, k 0.6, max add 100)", () => {
    expect(pointsForDistance(8, 1)).toBe(119);
    expect(pointsForDistance(10, 1)).toBe(148); // the midpoint - half the add
    expect(pointsForDistance(15, 1)).toBe(195);
  });

  it("is flat at 200 in the deep court - max add = the base", () => {
    expect(pointsForDistance(26, 1)).toBe(200);
    // the last meters buy almost nothing (the flat tail)
    expect(pointsForDistance(26, 1) - pointsForDistance(20, 1)).toBeLessThanOrEqual(1);
  });

  it("never decreases with distance", () => {
    let prev = 0;
    for (let d = EDGE; d <= 26; d += 0.5) {
      const p = pointsForDistance(d, 1);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe("pointsForDistance - hoop 2+ curve", () => {
  it("pays basePts at the edge, like every tier", () => {
    expect(pointsForDistance(EDGE, 2)).toBe(100);
    expect(pointsForDistance(EDGE, 3)).toBe(100);
  });

  it("matches the sign-off table (mid 12.5 m, k 0.5, max add 125)", () => {
    expect(pointsForDistance(10, 2)).toBe(126);
    expect(pointsForDistance(12.5, 2)).toBe(161); // the midpoint
    expect(pointsForDistance(16, 2)).toBe(206);
  });

  it("is flat at 225 in the deep court - max add = 1.25x base", () => {
    expect(pointsForDistance(26, 2)).toBe(225);
  });

  // the later midpoint shifts the reward deeper, matching the taller hoop
  it("pays less than hoop 1 at mid range, more in the deep court", () => {
    expect(pointsForDistance(10, 2)).toBeLessThan(pointsForDistance(10, 1));
    expect(pointsForDistance(18, 2)).toBeGreaterThan(pointsForDistance(18, 1));
  });
});

describe("rimPoints - the double hoop's smaller upper rim", () => {
  it("pays x1.25 on the whole curve value", () => {
    expect(rimPoints(EDGE, 3, "upper")).toBe(125);
    expect(rimPoints(10, 3, "upper")).toBe(Math.round(126 * 1.25)); // 158
    expect(rimPoints(26, 3, "upper")).toBe(281); // 225 x 1.25 rounded
  });

  it("any other rim pays the plain curve", () => {
    expect(rimPoints(10, 3, "lower")).toBe(126);
    expect(rimPoints(10, 1, "main")).toBe(148);
  });
});

describe("pointsForRims - made throws", () => {
  it("a double shot SUMS lower + upper = 2.25x the curve", () => {
    expect(pointsForRims(EDGE, 3, ["upper", "lower"])).toBe(225);
    expect(pointsForRims(26, 3, ["upper", "lower"])).toBe(225 + 281); // 506
  });

  it("a scored ball with no rim id still banks one plain curve value", () => {
    expect(pointsForRims(10, 1, [])).toBe(148);
  });
});

describe("the slam (purple orb throw)", () => {
  it("pays flat basePts - distance deliberately ignored", () => {
    expect(BALANCE.score.slamPts).toBe(BALANCE.score.basePts);
  });
});
