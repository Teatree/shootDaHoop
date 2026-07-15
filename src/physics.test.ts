import { describe, expect, it } from "vitest";
import { T } from "./tuning";
import { RIM, WALL_LEFT_X, WALL_RIGHT_X } from "./world";
import { createBallState, stepBall, type BallEvent, type BallState } from "./shared/physics";
import { hoopGeometryForTier, type HoopGeometry } from "./shared/tierRules";

// These tests drive the pure stepper with a FIXED dt, which makes them
// deterministic. Live play feeds variable frame times on purpose (design
// decision: the game should never feel "solved"), so tests assert
// physical invariants and event outcomes, not exact trajectories.

// standard release point: spawn-clamped free-throw spot, rim lane
const X0 = 20.675; // clampToCourt(FREE_THROW_X).x + releaseForwardM
const H0 = T.throw.releaseHeightM;
const D0 = RIM.d;

/** Launch velocity that puts the ANALYTIC arc through (tx, th) at time t. */
function arcTo(tx: number, th: number, t: number, x0 = X0, h0 = H0) {
  return {
    vx: (tx - x0) / t,
    vh: (th - h0) / t + 0.5 * T.throw.gravityM * t,
  };
}

/** Step for `seconds`, collecting events and per-step positions. */
function fly(s: BallState, seconds: number, dt = 1 / 120, geom?: HoopGeometry) {
  const events: BallEvent[] = [];
  const xs: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    events.push(...stepBall(s, dt, geom));
    xs.push(s.x);
  }
  return { events, xs };
}

const count = (evs: BallEvent[], e: BallEvent) => evs.filter((x) => x === e).length;

describe("scoring (swept rim-plane crossing)", () => {
  it("a clean centered arc scores - and is a swish (no rim contact)", () => {
    const { vx, vh } = arcTo(RIM.x, RIM.h, 1.2);
    const s = createBallState(X0, D0, H0, vx, vh);
    const { events } = fly(s, 2);
    expect(count(events, "score")).toBe(1);
    expect(s.scored).toBe(true);
    expect(s.rimTouched).toBe(false); // swish
    expect(events).not.toContain("miss");
  });

  it("crossing the rim plane OUTSIDE the opening does not score (far-catch regression)", () => {
    // descends through h = RIM.h almost 2m short of the rim center
    const { vx, vh } = arcTo(RIM.x - 1.9, RIM.h, 1.2);
    const s = createBallState(X0, D0, H0, vx, vh);
    const { events } = fly(s, 3);
    expect(events).not.toContain("score");
    expect(events).not.toContain("rim"); // far from the tips too
    expect(events).toContain("miss");
  });

  it("a fast flat shot under the rim never scores", () => {
    const s = createBallState(X0, D0, H0, 19, 3);
    const { events } = fly(s, 3);
    expect(events).not.toContain("score");
    expect(events).toContain("miss");
  });

  it("hitting a rim tip rattles (rim event + swish spoiled)", () => {
    // aim straight at the front rim tip
    const { vx, vh } = arcTo(RIM.x - RIM.r, RIM.h, 0.8);
    const s = createBallState(X0, D0, H0, vx, vh);
    const { events } = fly(s, 2);
    expect(events).toContain("rim");
    expect(s.rimTouched).toBe(true);
  });

  it("rejects a geometrically-good crossing when the ball is off the rim's depth lane", () => {
    // thrown from the far sideline (d=0): arriving at t=0.9 the depth has
    // only converged to ~2.59, outside hoop.scoreDepthM - no bucket
    const { vx, vh } = arcTo(RIM.x, RIM.h, 0.9);
    const s = createBallState(X0, 0, H0, vx, vh);
    const { events } = fly(s, 3);
    expect(events).not.toContain("score");
  });
});

describe("backboard (swept plane crossing)", () => {
  const boardX = RIM.x + RIM.r + T.hoop.boardGapM;

  it("a shot into the board bounces off it", () => {
    const s = createBallState(X0, D0, H0, 19, 16.5);
    const { events, xs } = fly(s, 2);
    expect(events).toContain("board");
    // never penetrates the board plane
    expect(Math.max(...xs)).toBeLessThanOrEqual(boardX - T.throw.ballRadiusM + 1e-9);
    expect(s.rimTouched).toBe(true); // board touch spoils the swish
  });

  it("a lob descending onto the UPPER board bounces (upper-board tunnel regression)", () => {
    // this arc's edge reaches the board plane while the center is still
    // just above boardTopM, then the center drops into the board - the
    // old one-shot crossing test missed it and the ball sailed through
    const { vx, vh } = arcTo(boardX, 7.9, 1.3);
    const s = createBallState(X0, D0, H0, vx, vh);
    const { events } = fly(s, 3);
    expect(events).toContain("board");
    expect(s.rimTouched).toBe(true);
  });

  it("a ball sailing OVER the board is not teleported back (board-teleport regression)", () => {
    const s = createBallState(X0, D0, H0, 8, 17);
    const { events, xs } = fly(s, 4);
    expect(events).not.toContain("board");
    expect(events).toContain("wall"); // it flew on and met the boundary
    // x must be monotonic until the wall bounce - no backwards snapping
    const firstWallX = Math.max(...xs);
    let prev = -Infinity;
    for (const x of xs) {
      if (x >= firstWallX) break;
      expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = x;
    }
  });
});

describe("boundary walls", () => {
  it("bounces off the right wall and never passes it", () => {
    const s = createBallState(X0, D0, H0, 8, 17);
    const { events, xs } = fly(s, 4);
    expect(events).toContain("wall");
    expect(Math.max(...xs)).toBeLessThanOrEqual(
      WALL_RIGHT_X - T.throw.ballRadiusM + 1e-9,
    );
  });

  it("bounces off the left wall and never passes it", () => {
    const s = createBallState(X0, D0, H0, -16, 12);
    const { events, xs } = fly(s, 4);
    expect(events).toContain("wall");
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(
      WALL_LEFT_X + T.throw.ballRadiusM - 1e-9,
    );
  });
});

describe("multi-rim geometry (tier 3 double hoop)", () => {
  const g3 = hoopGeometryForTier(3);
  const [upper, lower] = g3.rims;

  it("an explicit tier-1 geometry behaves exactly like the default", () => {
    const { vx, vh } = arcTo(RIM.x, RIM.h, 1.2);
    const a = createBallState(X0, D0, H0, vx, vh);
    const b = createBallState(X0, D0, H0, vx, vh);
    const ra = fly(a, 3);
    const rb = fly(b, 3, 1 / 120, hoopGeometryForTier(1));
    expect(rb.events).toEqual(ra.events);
    expect(rb.xs).toEqual(ra.xs);
  });

  it("a soft lob into the LOWER rim scores and resolves immediately", () => {
    // apex below the upper rim's plane → the upper can't interfere
    const { vx, vh } = arcTo(lower.x, lower.h, 1.1);
    const s = createBallState(X0, D0, H0, vx, vh);
    const apex = H0 + (vh * vh) / (2 * T.throw.gravityM);
    expect(apex).toBeLessThan(upper.h);
    const { events } = fly(s, 3, 1 / 120, g3);
    expect(s.rimsMade).toEqual(["lower"]);
    expect(count(events, "score")).toBe(1);
    expect(count(events, "made")).toBe(1);
    expect(events).not.toContain("miss");
  });

  it("a ball through the UPPER rim only still resolves as made (1 rim)", () => {
    // a steep lob through the upper opening's center; whatever it clips
    // on the way down, it must end made (≥1 rim), never a miss.
    // t = 2.2 s puts the apex ~2 m above the RAISED rim (owner
    // 2026-07-15: +1 full hoop height) so the descent is clean - the old
    // 1.6 s arc barely poked above the plane and never dropped through
    const { vx, vh } = arcTo(upper.x, upper.h, 2.2);
    const s = createBallState(X0, D0, H0, vx, vh);
    const { events } = fly(s, 6, 1 / 120, g3);
    expect(s.rimsMade[0]).toBe("upper");
    expect(count(events, "made")).toBe(1);
    expect(events).not.toContain("miss");
    expect(s.scored).toBe(true);
  });

  it("the DOUBLE SHOT is physically achievable: one launch takes both rims", () => {
    // deterministic grid search over launches that cross the upper
    // opening - the doc's promise is that the protruding upper enables a
    // ball to fall through it and carry into the lower opening
    let found: { vx: number; vh: number } | null = null;
    outer: for (let tx = upper.x - upper.r + 0.4; tx <= upper.x + upper.r - 0.36; tx += 0.05) {
      for (let t = 0.55; t <= 1.5; t += 0.05) {
        const { vx, vh } = arcTo(tx, upper.h, t);
        const s = createBallState(X0, D0, H0, vx, vh);
        fly(s, 6, 1 / 120, g3);
        if (s.rimsMade.length === 2) {
          found = { vx, vh };
          break outer;
        }
      }
    }
    expect(found).not.toBeNull();
    // replay the found launch and assert the full double-shot contract
    const s = createBallState(X0, D0, H0, found!.vx, found!.vh);
    const { events } = fly(s, 6, 1 / 120, g3);
    expect(s.rimsMade).toEqual(["upper", "lower"]);
    expect(count(events, "score")).toBe(2);
    expect(count(events, "made")).toBe(1); // resolves once, on the lower
    expect(events).not.toContain("miss");
  });
});

describe("ground", () => {
  it("reports exactly one miss, bounces to rest, then signals restDone once", () => {
    const s = createBallState(X0, D0, H0, 1, 3);
    const { events } = fly(s, 15);
    expect(count(events, "miss")).toBe(1);
    expect(count(events, "bounce")).toBeGreaterThanOrEqual(2);
    expect(s.resting).toBe(true);
    expect(count(events, "restDone")).toBe(1);
  });

  it("a made basket never also reports a miss", () => {
    const { vx, vh } = arcTo(RIM.x, RIM.h, 1.2);
    const s = createBallState(X0, D0, H0, vx, vh);
    const { events } = fly(s, 15);
    expect(count(events, "score")).toBe(1);
    expect(events).not.toContain("miss");
  });
});
