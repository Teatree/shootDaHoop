import { describe, expect, it } from "vitest";
import { BALANCE } from "./shared/config";
import { RIM } from "./shared/court";
import { resolveThrow } from "./shared/simulate";
import type { ThrowLaunch } from "./shared/messages";

// the same standard release the physics tests use
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

describe("resolveThrow (the server-side authority)", () => {
  it("resolves a clean arc as a made swish with distance-table points", () => {
    const { vx, vh } = arcTo(RIM.x, RIM.h, 1.2);
    const r = resolveThrow(launch(vx, vh));
    expect(r.made).toBe(true);
    expect(r.swish).toBe(true);
    expect(r.points).toBeGreaterThan(0);
    expect(r.distM).toBeCloseTo(RIM.x - SHOT_X, 5);
  });

  it("resolves an airball as a miss worth 0", () => {
    const r = resolveThrow(launch(2, 5));
    expect(r.made).toBe(false);
    expect(r.points).toBe(0);
  });

  it("pays slamPts for a made slam regardless of distance", () => {
    const { vx, vh } = arcTo(RIM.x, RIM.h, 1.2);
    const r = resolveThrow(launch(vx, vh, true));
    expect(r.made).toBe(true);
    expect(r.points).toBe(BALANCE.score.slamPts);
  });

  it("is deterministic: the same launch always resolves identically", () => {
    const { vx, vh } = arcTo(RIM.x - RIM.r, RIM.h, 0.8); // rim rattle - knife-edge
    const a = resolveThrow(launch(vx, vh));
    const b = resolveThrow(launch(vx, vh));
    expect(a).toEqual(b);
  });
});
