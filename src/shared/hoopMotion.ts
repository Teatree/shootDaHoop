// ════════════════════════════════════════════════════════════════════
//  HOOP MOTION - the Hoop 4 moving hoop's shared clock.
//
//  The carriage (rim + backboard; the pole stays) rides slowly between
//  a low and a high stop, dwelling a RANDOM dwellMinS..dwellMaxS at
//  each stop. Multiplayer + physics need every screen AND the server to
//  agree on where the hoop is at any instant, so the schedule is a PURE
//  FOLD over epoch time: the authority rolls one {seed, anchorMs} at
//  the upgrade (the jukebox startedAtMs pattern, plus a seed so the
//  random dwells need no further messages), and anyone holding
//  (spec, state) computes the identical timeline forever - it even
//  survives server restarts, because it is anchored to epoch time.
//
//  Dependency-free: no Phaser, no DOM, no Node.
// ════════════════════════════════════════════════════════════════════

import type { HoopMotionSpec } from "./tierChanges";
import {
  hoopGeometryForTier,
  hoopMotionForTier,
  type HoopGeometry,
} from "./tierRules";

/** The authority-rolled schedule: everything needed to replay it. */
export interface HoopMotionState {
  /** 32-bit seed - dwell k's length derives from hash(seed, k) */
  seed: number;
  /** epoch ms the schedule began (the upgrade moment) */
  anchorMs: number;
}

/** Deterministic [0,1) for dwell index k - the mulberry32 mix. */
function rand01(seed: number, k: number): number {
  let t = (seed ^ Math.imul(k + 1, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Slow-in slow-out - the "gradual" feel of each travel leg. */
function smoothstep(f: number): number {
  return f * f * (3 - 2 * f);
}

/**
 * Cursor memo: live rendering queries the same schedule at 60 Hz with
 * monotonically growing time - remember which segment the last query
 * landed in so the walk is O(1). Out-of-order queries (a replay seeking
 * backwards) just restart the walk from the anchor; segments average
 * ~5.5 s, so even a week-old anchor walks ~110k trivial iterations once.
 * Bounded: replays and the live world make a handful of keys at most.
 */
interface Cursor {
  k: number; //         dwell index the walk is at
  segStartS: number; // seconds from anchor where dwell k begins
}
const cursors = new Map<string, Cursor>();
const CURSOR_CAP = 16;

/**
 * The carriage lift in meters [0..travelM] at an epoch instant.
 * The timeline from the anchor: dwell 0 (low) → rise → dwell 1 (high)
 * → fall → dwell 2 (low) → … Times at or before the anchor sit at the
 * low stop.
 */
export function motionLiftAt(
  spec: HoopMotionSpec,
  state: HoopMotionState,
  epochMs: number,
): number {
  const tS = (epochMs - state.anchorMs) / 1000;
  if (!Number.isFinite(tS) || tS <= 0) return 0;

  const key = `${state.seed}:${state.anchorMs}`;
  const memo = cursors.get(key);
  let k = 0;
  let segStartS = 0;
  if (memo && memo.segStartS <= tS) {
    k = memo.k;
    segStartS = memo.segStartS;
  }

  for (;;) {
    const dwellS =
      spec.dwellMinS + rand01(state.seed, k) * (spec.dwellMaxS - spec.dwellMinS);
    const atHigh = k % 2 === 1; // dwell 0 low, dwell 1 high, alternating
    const dwellEndS = segStartS + dwellS;
    if (tS < dwellEndS) {
      saveCursor(key, k, segStartS);
      return atHigh ? spec.travelM : 0;
    }
    const travelEndS = dwellEndS + spec.travelS;
    if (tS < travelEndS) {
      saveCursor(key, k, segStartS);
      const e = smoothstep((tS - dwellEndS) / spec.travelS);
      return atHigh ? spec.travelM * (1 - e) : spec.travelM * e;
    }
    k += 1;
    segStartS = travelEndS;
  }
}

function saveCursor(key: string, k: number, segStartS: number) {
  if (!cursors.has(key) && cursors.size >= CURSOR_CAP) {
    // drop the oldest entry - insertion order is good enough here
    const first = cursors.keys().next().value;
    if (first !== undefined) cursors.delete(first);
  }
  cursors.set(key, { k, segStartS });
}

/**
 * The tier's hoop geometry AT AN INSTANT: the static fold with the
 * carriage lift applied - rims and board ride up together (the owner's
 * "the wall moves together with the Hoop rim"; boardX and the pole
 * never move). Returns the plain cached geometry when the tier doesn't
 * move or no schedule exists, and NEVER mutates the static cache - the
 * lifted variant is a fresh copy every call.
 */
export function hoopGeometryAt(
  tierId: number,
  state: HoopMotionState | null | undefined,
  epochMs: number,
): HoopGeometry {
  const spec = hoopMotionForTier(tierId);
  const base = hoopGeometryForTier(tierId);
  if (!spec || !state) return base;
  const lift = motionLiftAt(spec, state, epochMs);
  if (lift === 0) return base;
  return {
    rims: base.rims.map((r) => ({ ...r, h: r.h + lift })),
    boardX: base.boardX,
    boardTopM: base.boardTopM + lift,
    boardBottomM: base.boardBottomM + lift,
  };
}

/**
 * Bound a client-stamped launch time to the server's clock: the stamp
 * is what keeps "one launch = one trajectory" against the moving hoop
 * (thrower's visual flight and the server's resolution read the SAME
 * hoop timeline), but it is client input - clamp it to a small window
 * so a doctored stamp is worth centimeters at most (the carriage does
 * ~0.5 m/s). Absent/garbage stamps fall back to `now`.
 */
export function clampLaunchStamp(
  atMs: number | undefined,
  nowMs: number,
): number {
  if (typeof atMs !== "number" || !Number.isFinite(atMs)) return nowMs;
  return Math.min(nowMs + 500, Math.max(nowMs - 2500, atMs));
}
