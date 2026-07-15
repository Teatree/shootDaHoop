import { BALANCE as T } from "./config";
import { RIM, WALL_LEFT_X, WALL_RIGHT_X, clamp } from "./court";
import {
  hoopGeometryForTier,
  type HoopGeometry,
  type RimSpec,
} from "./tierRules";

// Pure ball physics - no Phaser, no DOM, no Node. Shared by the client
// (Ball in ball.ts owns the sprites and feeds this stepper) and the server
// (resolveThrow in simulate.ts); unit tests drive it directly.
//
// The integration is substepped so travel per step never exceeds a
// fraction of the ball radius. Scoring is a SWEPT test against the segment
// travelled this substep - "is past the plane" position checks teleport
// fast balls (see docs/gameplay-prototype.md, discoveries #1/#2). The
// backboard is a circle-vs-segment overlap test, which the substep travel
// cap makes tunnel-proof (a one-shot plane-crossing test let lobs through
// the upper board - see collideBackboard).
//
// Determinism: stepBall is deterministic for a fixed dt sequence, and
// EVERY consumer now feeds it the same PHYSICS_DT quanta - the server's
// resolveThrow and the client's visual Ball (which accumulates frame time
// and steps in fixed chunks). One launch = one trajectory everywhere, so
// what the player SEES going through the rim is exactly what the
// authority scored (owner bug 2026-07-16: variable frame-dt stepping let
// the visual ball swish while the server's fixed-dt sim ruled a miss).
// Outcomes stay organic because launch params come from analog input.
// Replays still record positions rather than re-simulating.

/** The one step size every ball simulation uses (server resolution AND
 *  the client's visual flight) - sharing it is what keeps them agreeing. */
export const PHYSICS_DT = 1 / 120;

export interface BallState {
  x: number; //  court meters
  d: number;
  h: number;
  vx: number; // m/s toward the hoop (+x)
  vh: number; // m/s up
  scored: boolean; //   any rim made
  rimsMade: string[]; //rim ids made, in order (tier 3: a "double shot" has 2)
  rimTouched: boolean; // any rim/board contact - spoils the swish
  resolved: boolean; //  score/miss decided
  resting: boolean; //   rolling out on the floor
  restT: number;
}

export type BallEvent =
  | "score" //    crossed a rim plane inside its opening - one bucket
  | "made" //     the throw RESOLVED as made (fires exactly once)
  | "miss" //     touched the floor with no bucket - can no longer score
  | "rim" //      bounced off a rim tip
  | "board" //    bounced off the backboard
  | "wall" //     bounced off a boundary wall
  | "bounce" //   hit the floor
  | "restDone"; // sat still long enough - despawn me

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
    rimsMade: [],
    rimTouched: false,
    resolved: false,
    resting: false,
    restT: 0,
  };
}

/**
 * Advance the ball by dt seconds; returns what happened along the way.
 * `geom` is the ACTIVE tier's hoop (shared/tierRules.ts) - every rim in it
 * is hittable and scoreable; the throw resolves once nothing below the
 * lowest made point can still score. Defaults to the tier-1 hoop so
 * geometry-agnostic callers/tests behave exactly as before.
 */
export function stepBall(
  s: BallState,
  dt: number,
  geom: HoopGeometry = hoopGeometryForTier(1),
): BallEvent[] {
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

  // substepped so travel per step ≤ frac·radius - CCD-ish safety
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
      for (const rim of geom.rims) {
        // a CLEAN ENTRY isn't grabbed by the iron (owner bug 2026-07-16:
        // flat slam arcs into the raised upper rim): the tip's point
        // collider reaches ballR+0.02 - more than twice the drawn iron -
        // and used to swat balls whose center was still above the plane
        // but already dropping straight into the opening
        if (willEnterOpening(s, rim)) continue;
        if (collideRimPoint(s, rim.x - rim.r, rim.h)) ev.push("rim");
        if (collideRimPoint(s, rim.x + rim.r, rim.h)) ev.push("rim");
      }
      if (collideBackboard(s, prevX, geom)) ev.push("board");
      for (const rim of geom.rims) {
        if (checkScore(s, prevX, prevH, rim, geom)) {
          ev.push("score");
          if (s.resolved) ev.push("made");
        }
      }
    }

    if (collideWall(s)) ev.push("wall");
    stepGround(s, ev);
  }

  return ev;
}

/**
 * Is this ball, descending from above the rim's plane, on a path whose
 * center crosses INSIDE the opening (full ball radius margin)? Then it's
 * a clean bucket in the making and the rim tips must not swat it. The
 * short projection ignores gravity - the look-ahead window is tiny.
 */
function willEnterOpening(s: BallState, rim: RimSpec): boolean {
  if (s.vh >= 0 || s.h <= rim.h || s.rimsMade.includes(rim.id)) return false;
  const t = (s.h - rim.h) / -s.vh;
  // only the last moments before the plane - beyond that the projection
  // (and the ball's path) can still change too much to wave the iron off
  if (t > 0.12) return false;
  const xCross = s.x + s.vx * t;
  return Math.abs(xCross - rim.x) < rim.r - T.throw.ballRadiusM;
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
 * Circle-vs-segment board collision: the board is the vertical segment
 * (bx, boardBottom)–(bx, boardTop) and the ball hits it whenever its
 * circle overlaps - the substep travel cap (half a radius) means overlap
 * can't be stepped over. Resolving along the ACTUAL contact normal (face,
 * top/bottom edge, either side) fixes two bugs the old one-shot plane
 * crossing had: "is past the plane" teleports (discovery #2), and lobs
 * whose edge reached the plane while the CENTER was still above boardTop
 * - the height check failed at the only substep that could fire, and the
 * ball sailed down through the upper board.
 */
function collideBackboard(
  s: BallState,
  prevX: number,
  geom: HoopGeometry,
): boolean {
  const bx = geom.boardX;
  const r = T.throw.ballRadiusM;
  const nearH = clamp(s.h, geom.boardBottomM, geom.boardTopM);
  // the face we can hit is the side we were on at the substep start; if
  // the center crossed the plane this substep (fast ball, or shoved by a
  // rim push-out), resolve against that face, never the far one
  const side = prevX < bx ? -1 : 1;
  let dx = s.x - bx;
  if (Math.sign(dx) !== side) dx = 0;
  const dh = s.h - nearH;
  const dist = Math.hypot(dx, dh);
  if (dist >= r) return false;
  const nx = dist === 0 ? side : dx / dist;
  const nh = dist === 0 ? 0 : dh / dist;
  const vDotN = s.vx * nx + s.vh * nh;
  if (vDotN < 0) {
    const e = T.hoop.boardRestitution;
    s.vx -= (1 + e) * vDotN * nx;
    s.vh -= (1 + e) * vDotN * nh;
  }
  // push out of penetration, radially from the closest board point
  s.x = bx + nx * r;
  s.h = nearH + nh * r;
  s.rimTouched = true; // board touch also spoils the swish
  return true;
}

/**
 * Swept scoring against ONE rim: the segment travelled this substep must
 * cross that rim's plane downward, and the interpolated crossing point
 * must fit its opening with the FULL ball radius - physics decides, not
 * whichever position the frame happened to sample.
 *
 * Each rim scores at most once. The throw only RESOLVES when the lowest
 * rim is made (nothing below can still score) - a ball that swished the
 * upper rim of a double hoop keeps flying, net-dragged, toward the lower
 * one: the "double shot".
 */
function checkScore(
  s: BallState,
  prevX: number,
  prevH: number,
  rim: RimSpec,
  geom: HoopGeometry,
): boolean {
  if (s.vh >= 0 || s.rimsMade.includes(rim.id)) return false;
  if (!(prevH > rim.h && s.h <= rim.h)) return false;
  const tCross = (prevH - rim.h) / (prevH - s.h);
  const xCross = prevX + (s.x - prevX) * tCross;
  if (Math.abs(xCross - rim.x) >= rim.r - T.throw.ballRadiusM) return false;
  if (Math.abs(s.d - RIM.d) >= T.hoop.scoreDepthM) return false;

  s.rimsMade.push(rim.id);
  s.scored = true;
  const lowest = geom.rims.reduce((a, b) => (a.h < b.h ? a : b));
  if (rim.id === lowest.id) s.resolved = true;
  // net drag
  s.vx *= 0.25;
  s.vh *= 0.55;
  // THE FUNNEL (owner 2026-07-16): a ball through an upper rim must go
  // through the rim below it too, so BOTH register - the net hands the
  // ball toward the next opening. Before this, the upper's net drag
  // dropped the ball almost straight down, LEFT of the lower opening
  // (the upper protrudes), so the second hoop rarely registered. Pure
  // and deterministic - the client's flight and the server's resolution
  // both steer identically.
  const below = geom.rims
    .filter((r) => r.h < rim.h && !s.rimsMade.includes(r.id))
    .sort((a, b) => b.h - a.h)[0];
  if (below) {
    // time to fall to the next rim under gravity (vh is ≤ 0 here)
    const drop = rim.h - below.h;
    const tFall =
      (s.vh + Math.sqrt(s.vh * s.vh + 2 * T.throw.gravityM * drop)) /
      T.throw.gravityM;
    if (tFall > 0) s.vx = (below.x - s.x) / tFall;
  }
  return true;
}

/** Boundary walls past both baselines - the physical scene edges. */
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
      // once it hits the floor it can't score further - resolve now: a
      // miss if nothing was made, or the final "made" for a ball that
      // took an upper rim but never reached the lower one
      s.resolved = true;
      ev.push(s.scored ? "made" : "miss");
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
