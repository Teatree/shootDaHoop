import { describe, expect, it } from "vitest";
import { T } from "./tuning";
import { RIM, WALL_LEFT_X, WALL_RIGHT_X } from "./world";
import { createBallState, stepBall, type BallEvent, type BallState } from "./shared/physics";

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
function fly(s: BallState, seconds: number, dt = 1 / 120) {
  const events: BallEvent[] = [];
  const xs: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    events.push(...stepBall(s, dt));
    xs.push(s.x);
  }
  return { events, xs };
}

const count = (evs: BallEvent[], e: BallEvent) => evs.filter((x) => x === e).length;

describe("scoring (swept rim-plane crossing)", () => {
  it("a clean centered arc scores — and is a swish (no rim contact)", () => {
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
    // only converged to ~2.59, outside hoop.scoreDepthM — no bucket
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

  it("a ball sailing OVER the board is not teleported back (board-teleport regression)", () => {
    const s = createBallState(X0, D0, H0, 8, 17);
    const { events, xs } = fly(s, 4);
    expect(events).not.toContain("board");
    expect(events).toContain("wall"); // it flew on and met the boundary
    // x must be monotonic until the wall bounce — no backwards snapping
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
