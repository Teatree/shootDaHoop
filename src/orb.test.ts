import { describe, expect, it } from "vitest";
import { BALANCE } from "./shared/config";
import { RIM } from "./shared/court";
import { orbHitTest, rollOrbSpawn } from "./shared/orb";
import { resolveThrow } from "./shared/simulate";
import type { ThrowLaunch } from "./shared/messages";

// the same standard release the simulate tests use
const SHOT_X = 20.175;
const X0 = 20.675;
const H0 = BALANCE.throw.releaseHeightM;

function launch(vx: number, vh: number, slam = false): ThrowLaunch {
  return { shotX: SHOT_X, shotD: RIM.d, x: X0, d: RIM.d, h: H0, vx, vh, slam };
}

function arcTo(tx: number, th: number, t: number) {
  return {
    vx: (tx - X0) / t,
    vh: (th - H0) / t + 0.5 * BALANCE.throw.gravityM * t,
  };
}

describe("rollOrbSpawn (shared spawn rule)", () => {
  it("spawns inside the declared zone, above the rim, in the rim lane", () => {
    const zoneEdge = RIM.x - BALANCE.move.hoopStandoffM;
    for (const r of [0, 0.25, 0.5, 0.99]) {
      const orb = rollOrbSpawn(1, () => r);
      expect(orb.x).toBeLessThanOrEqual(zoneEdge);
      expect(orb.x).toBeGreaterThanOrEqual(zoneEdge - BALANCE.orb.rangeXM);
      expect(orb.h).toBeGreaterThanOrEqual(RIM.h + BALANCE.orb.aboveHoopM);
      expect(orb.h).toBeLessThanOrEqual(
        RIM.h + BALANCE.orb.aboveHoopM + BALANCE.orb.rangeHM,
      );
      expect(orb.d).toBe(RIM.d);
    }
  });

  it("carries the seq it was given", () => {
    expect(rollOrbSpawn(7).seq).toBe(7);
  });
});

describe("orbHitTest (the ONE hit rule)", () => {
  const orb = { seq: 1, x: 15, d: RIM.d, h: 9 };
  const hitR = BALANCE.orb.radiusM + BALANCE.throw.ballRadiusM;

  it("hits when the ball center is within r + ballR in the lane", () => {
    expect(orbHitTest(orb, 15, RIM.d, 9)).toBe(true);
    expect(orbHitTest(orb, 15 + hitR * 0.9, RIM.d, 9)).toBe(true);
  });

  it("misses outside the radius or outside the depth window", () => {
    expect(orbHitTest(orb, 15 + hitR * 1.1, RIM.d, 9)).toBe(false);
    expect(
      orbHitTest(orb, 15, RIM.d + BALANCE.orb.hitDepthM + 0.01, 9),
    ).toBe(false);
  });
});

describe("resolveThrow with an orb in the arc", () => {
  // aim the arc's rising leg straight through a spawnable orb spot
  const orb = rollOrbSpawn(3, () => 0.5);

  it("rules the throw consumed at the orb, unscored", () => {
    const { vx, vh } = arcTo(orb.x, orb.h, 0.9);
    const r = resolveThrow(launch(vx, vh), orb);
    expect(r.orbHitAtS).toBeDefined();
    expect(r.orbHitAtS!).toBeGreaterThan(0);
    expect(r.made).toBe(false);
    expect(r.points).toBe(0);
    expect(r.resolvedAtS).toBe(r.orbHitAtS);
  });

  it("ignores the orb when the arc misses it", () => {
    const { vx, vh } = arcTo(RIM.x, RIM.h, 1.2);
    const withOrb = resolveThrow(
      launch(vx, vh),
      { seq: 9, x: 2, d: RIM.d, h: 12 }, // far off the arc
    );
    const without = resolveThrow(launch(vx, vh));
    expect(withOrb.orbHitAtS).toBeUndefined();
    expect(withOrb).toEqual(without);
  });

  it("resolves identically with orb=null and orb omitted", () => {
    const { vx, vh } = arcTo(RIM.x, RIM.h, 1.2);
    expect(resolveThrow(launch(vx, vh), null)).toEqual(
      resolveThrow(launch(vx, vh)),
    );
  });
});
