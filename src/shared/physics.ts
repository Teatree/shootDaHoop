import { BALANCE as T } from "./config";
import { RIM, WALL_LEFT_X, WALL_RIGHT_X, clamp } from "./court";

// Pure ball physics — no Phaser, no DOM, no Node. Shared by the client
// (Ball in ball.ts owns the sprites and feeds this stepper) and the server
// (resolveThrow in simulate.ts); unit tests drive it directly.
//
// The integration is substepped so travel per step never exceeds a
// fraction of the ball radius, and every plane interaction (scoring,
// backboard) is a SWEPT test against the segment travelled this substep —
// "is past the plane" position checks teleport fast balls (see
// docs/gameplay-prototype.md, discoveries #1/#2).
//
// Determinism note (deliberate design decision): stepBall is deterministic
// for a fixed dt sequence, but live play feeds it variable frame times, so
// real-game outcomes stay organic and the game never feels "solved".
// Replays therefore record positions rather than re-simulating.

export interface BallState {
  x: number; //  court meters
  d: number;
  h: number;
  vx: number; // m/s toward the hoop (+x)
  vh: number; // m/s up
  scored: boolean;
  rimTouched: boolean; // any rim/board contact — spoils the swish
  resolved: boolean; //  score/miss decided
  resting: boolean; //   rolling out on the floor
  restT: number;
}

export type BallEvent =
  | "score" //    crossed the rim plane inside the opening — a bucket
  | "miss" //     touched the floor unresolved — can no longer score
  | "rim" //      bounced off a rim tip
  | "board" //    bounced off the backboard
  | "wall" //     bounced off a boundary wall
  | "bounce" //   hit the floor
  | "restDone"; // sat still long enough — despawn me

export function createBallState(
  x: number,
  d: number,
  h: number,
  vx: number,
  vh: number,
): BallState {
  return {
    x,
    d,
    h,
    vx,
    vh,
    scored: false,
    rimTouched: false,
    resolved: false,
    resting: false,
    restT: 0,
  };
}

/** Advance the ball by dt seconds; returns what happened along the way. */
export function stepBall(s: BallState, dt: number): BallEvent[] {
  const ev: BallEvent[] = [];

  if (s.resting) {
    s.vx *= Math.exp(-6 * dt);
    s.x += s.vx * dt;
    const before = s.restT;
    s.restT += dt;
    // fires exactly once, on the crossing
    if (before < T.ground.restDelayS && s.restT >= T.ground.restDelayS)
      ev.push("restDone");
    return ev;
  }

  // substepped so travel per step ≤ frac·radius — CCD-ish safety
  const speed = Math.hypot(s.vx, s.vh);
  const maxTravel = T.throw.substepTravelFrac * T.throw.ballRadiusM;
  const steps = clamp(Math.ceil((speed * dt) / maxTravel), 1, T.throw.maxSubsteps);
  const sdt = dt / steps;

  for (let i = 0; i < steps && !s.resting; i++) {
    const prevX = s.x;
    const prevH = s.h;

    s.vh -= T.throw.gravityM * sdt;
    s.x += s.vx * sdt;
    s.h += s.vh * sdt;
    // depth converges on the rim's lane so the shot reads on the hoop
    s.d += (RIM.d - s.d) * Math.min(1, T.throw.depthEaseRate * sdt);

    // only interact with the hoop when we're in its lane
    if (Math.abs(s.d - RIM.d) < T.hoop.laneDepthM) {
      if (collideRimPoint(s, RIM.x - RIM.r, RIM.h)) ev.push("rim");
      if (collideRimPoint(s, RIM.x + RIM.r, RIM.h)) ev.push("rim");
      if (collideBackboard(s, prevX)) ev.push("board");
      if (checkScore(s, prevX, prevH)) ev.push("score");
    }

    if (collideWall(s)) ev.push("wall");
    stepGround(s, ev);
  }

  return ev;
}

/** Circle-vs-point bounce against a rim tip. */
function collideRimPoint(s: BallState, px: number, ph: number): boolean {
  const dx = s.x - px;
  const dh = s.h - ph;
  const dist = Math.hypot(dx, dh);
  const minDist = T.throw.ballRadiusM + 0.02;
  if (dist === 0 || dist >= minDist) return false;
  const nx = dx / dist;
  const nh = dh / dist;
  const vDotN = s.vx * nx + s.vh * nh;
  if (vDotN < 0) {
    const e = T.hoop.rimRestitution;
    s.vx -= (1 + e) * vDotN * nx;
    s.vh -= (1 + e) * vDotN * nh;
  }
  // push out of penetration
  s.x = px + nx * minDist;
  s.h = ph + nh * minDist;
  s.rimTouched = true;
  return true;
}

/**
 * Swept board check: the ball must CROSS the board plane during this
 * substep. A mere "is past the plane" test teleported balls that sailed
 * over the board back onto its face when they descended on the far side.
 */
function collideBackboard(s: BallState, prevX: number): boolean {
  const bx = RIM.x + RIM.r + T.hoop.boardGapM;
  const r = T.throw.ballRadiusM;
  if (
    s.vx > 0 &&
    prevX + r <= bx &&
    s.x + r > bx &&
    s.h > T.hoop.boardBottomM &&
    s.h < T.hoop.boardTopM
  ) {
    s.x = bx - r;
    s.vx = -s.vx * T.hoop.boardRestitution;
    s.rimTouched = true; // board touch also spoils the swish
    return true;
  }
  return false;
}

/**
 * Swept scoring: the segment travelled this substep must cross the rim
 * plane (h = RIM.h) downward, and the interpolated crossing point must fit
 * the opening with the FULL ball radius — physics decides, not whichever
 * position the frame happened to sample.
 */
function checkScore(s: BallState, prevX: number, prevH: number): boolean {
  if (s.scored || s.vh >= 0) return false;
  if (!(prevH > RIM.h && s.h <= RIM.h)) return false;
  const tCross = (prevH - RIM.h) / (prevH - s.h);
  const xCross = prevX + (s.x - prevX) * tCross;
  if (Math.abs(xCross - RIM.x) >= RIM.r - T.throw.ballRadiusM) return false;
  if (Math.abs(s.d - RIM.d) >= T.hoop.scoreDepthM) return false;

  s.scored = true;
  s.resolved = true;
  // net drag
  s.vx *= 0.25;
  s.vh *= 0.55;
  return true;
}

/** Boundary walls past both baselines — the physical scene edges. */
function collideWall(s: BallState): boolean {
  const r = T.throw.ballRadiusM;
  if (s.vx > 0 && s.x + r > WALL_RIGHT_X) {
    s.x = WALL_RIGHT_X - r;
    s.vx = -s.vx * T.wall.restitution;
    return true;
  }
  if (s.vx < 0 && s.x - r < WALL_LEFT_X) {
    s.x = WALL_LEFT_X + r;
    s.vx = -s.vx * T.wall.restitution;
    return true;
  }
  return false;
}

function stepGround(s: BallState, ev: BallEvent[]) {
  const r = T.throw.ballRadiusM;
  if (s.h <= r && s.vh < 0) {
    s.h = r;
    if (!s.resolved) {
      // once it hits the floor it can't score — call the miss now
      s.resolved = true;
      ev.push("miss");
    }
    s.vh = -s.vh * T.ground.restitution;
    s.vx *= T.ground.slideFriction;
    ev.push("bounce");
    if (s.vh < T.ground.restSpeedM) {
      s.vh = 0;
      s.resting = true;
    }
  }
}
