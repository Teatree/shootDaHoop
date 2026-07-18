import { describe, expect, it } from "vitest";
import { BALANCE } from "./shared/config";
import {
  pointsForDistance,
  pointsForRims,
  rimPoints,
  slamPoints,
} from "./shared/scoring";

// The logistic distance curve (owner spec 2026-07-17, reworked
// 2026-07-19 with the court shortening): the drop-off midpoint sits at
// the COURT'S CENTER (~9.33 m from the rim) on every curve and the max
// add is 75% of the base. The exact values here are the sign-off
// tables from docs/scoring-curve.md - a curve tweak that silently
// moves the economy trips a test.

const EDGE = BALANCE.move.hoopStandoffM; // 5 m - the closest legal shot

describe("pointsForDistance - hoop 1 curve", () => {
  it("pays exactly basePts at the keep-out edge (the normal score point)", () => {
    expect(pointsForDistance(EDGE, 1)).toBe(100);
  });

  it("the midpoint IS the court center (owner 2026-07-19)", () => {
    const centerX = (BALANCE.court.leftEdgeM + BALANCE.court.lengthM) / 2;
    const rimX = BALANCE.court.lengthM - BALANCE.court.rimFromBaselineM;
    expect(BALANCE.score.curves.tier1.midM).toBeCloseTo(rimX - centerX, 10);
    expect(BALANCE.score.curves.tier2plus.midM).toBeCloseTo(rimX - centerX, 10);
  });

  it("matches the sign-off table (mid ~8.86 m, k 0.6, max add 75)", () => {
    expect(pointsForDistance(8, 1)).toBe(123);
    expect(pointsForDistance(10, 1)).toBe(147);
    expect(pointsForDistance(15, 1)).toBe(173);
  });

  it("is flat at 175 in the deep court - max add = 75% of the base", () => {
    expect(pointsForDistance(20, 1)).toBe(175);
    // the last meters buy almost nothing (the flat tail)
    expect(pointsForDistance(20, 1) - pointsForDistance(16, 1)).toBeLessThanOrEqual(1);
  });

  it("never decreases with distance", () => {
    let prev = 0;
    for (let d = EDGE; d <= 21; d += 0.5) {
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

  it("matches the sign-off table (mid ~8.86 m, k 0.5, max add 75)", () => {
    expect(pointsForDistance(10, 2)).toBe(144);
    expect(pointsForDistance(12.5, 2)).toBe(163);
    expect(pointsForDistance(16, 2)).toBe(173);
  });

  it("is flat at 175 in the deep court, same cap as every curve", () => {
    expect(pointsForDistance(20, 2)).toBe(175);
  });

  // the shallower k ramps later, matching the taller hoop
  it("pays a touch less than hoop 1 at mid range, meets it at the cap", () => {
    expect(pointsForDistance(10, 2)).toBeLessThan(pointsForDistance(10, 1));
    expect(pointsForDistance(20, 2)).toBe(pointsForDistance(20, 1));
  });
});

describe("rimPoints - the double hoop's smaller upper rim", () => {
  it("pays x1.25 on the whole curve value", () => {
    expect(rimPoints(EDGE, 3, "upper")).toBe(125);
    expect(rimPoints(10, 3, "upper")).toBe(180); // round(144 x 1.25)
    expect(rimPoints(20, 3, "upper")).toBe(219); // 175 x 1.25 rounded
  });

  it("any other rim pays the plain curve", () => {
    expect(rimPoints(10, 3, "lower")).toBe(144);
    expect(rimPoints(10, 1, "main")).toBe(147);
  });
});

describe("pointsForRims - made throws", () => {
  it("a double shot SUMS lower + upper = 2.25x the curve", () => {
    expect(pointsForRims(EDGE, 3, ["upper", "lower"])).toBe(225);
    expect(pointsForRims(20, 3, ["upper", "lower"])).toBe(175 + 219); // 394
  });

  it("a scored ball with no rim id still banks one plain curve value", () => {
    expect(pointsForRims(10, 1, [])).toBe(147);
  });
});

describe("the slam (purple orb throw)", () => {
  it("pays flat basePts - distance deliberately ignored", () => {
    expect(BALANCE.score.slamPts).toBe(BALANCE.score.basePts);
  });

  it("a teleport DOUBLE pays per rim: 200 through both (owner 2026-07-19)", () => {
    expect(slamPoints(1)).toBe(BALANCE.score.slamPts);
    expect(slamPoints(2)).toBe(BALANCE.score.slamPts * 2);
    // clamped: a stray count never mints more than the double,
    // and a made slam always banks at least the flat base
    expect(slamPoints(3)).toBe(BALANCE.score.slamPts * 2);
    expect(slamPoints(0)).toBe(BALANCE.score.slamPts);
  });
});
