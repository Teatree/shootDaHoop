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

  // Tier 4's moving hoop: geometry is a function of TIME - the launch
  // stamp anchors the flight to the shared timeline, so one stamped
  // launch resolves identically no matter WHEN the server runs it.
  it("a stamped tier-4 launch resolves identically regardless of wall clock", () => {
    const motion = { seed: 0xabcdef, anchorMs: 1_000_000 };
    const { vx, vh } = arcTo(RIM.x, RIM.h * 1.4 * 1.1, 1.2);
    const stamped = { ...launch(vx, vh), atMs: motion.anchorMs + 7000 };
    const a = resolveThrow(stamped, null, 4, motion);
    const b = resolveThrow(stamped, null, 4, motion);
    expect(a).toEqual(b);
  });

  it("the hoop's position at launch time can decide the outcome", () => {
    const motion = { seed: 0xabcdef, anchorMs: 1_000_000 };
    // a clean arc over the LOW stop's rim: apex 0.8 m above the plane
    // (clears the front tip on the way up), dropping dead-center - a
    // bucket while the hoop is DOWN, unreachable once it lifts 1.2 m
    const g = BALANCE.throw.gravityM;
    const topH = RIM.h * 1.4 * 1.1;
    const apex = topH + 0.8;
    const vh = Math.sqrt(2 * g * (apex - H0));
    const tCross = vh / g + Math.sqrt((2 * 0.8) / g);
    const vx = (RIM.x - X0) / tCross;
    // sweep launch stamps across a full cycle - if outcomes never vary,
    // the moving geometry isn't being read at all
    const outcomes = new Set<string>();
    for (let s = 0; s < 14; s += 1) {
      const stamped = { ...launch(vx, vh), atMs: motion.anchorMs + s * 1000 };
      outcomes.add(String(resolveThrow(stamped, null, 4, motion).made));
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });
});
