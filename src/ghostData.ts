// Ghost record data: sample types + interpolation. Pure (no Phaser) so
// unit tests can drive it. A frame sample IS the streamed AvatarState
// plus recording time and world dressing - the replication payload and
// the recording format are one type, by design.

import { lerpPoseState } from "./shared/pose";
import type { AvatarState } from "./shared/messages";
import type { BallLookId } from "./shared/tierChanges";

export interface FrameSample extends AvatarState {
  t: number; //  seconds since recording start
  // world dressing the player saw
  orb: { x: number; d: number; h: number; age: number } | null;
  bubble: { text: string; age: number } | null;
}

export interface BallSample {
  t: number;
  x: number;
  d: number;
  h: number;
}

export interface ThrowRecording {
  name: string;
  /** the throw this recording belongs to - the persistence key
   *  (server-stored replays, owner 2026-07-17) */
  throwId?: string;
  /** the thrower's rig look, stamped at record time - a replay fetched
   *  by ANOTHER player dresses the ghost correctly (absent on old
   *  recordings: the local look stands in) */
  look?: {
    shirtColor: number;
    skinTint: number;
    lowerTint: number;
    headVariant: number;
  };
  /**
   * The ball look AT RECORD TIME - the upgrade recolour rule: a replay
   * from before an upgrade keeps the old look, so the world stays
   * temporally consistent (HOOP_PROGRESSION.md). Optional so recordings
   * from before this field default to classic.
   */
  ballLook?: BallLookId;
  /**
   * The world tier AT RECORD TIME (owner ask 2026-07-18): when it
   * differs from the live tier, the replay rebuilds THAT hoop as a
   * ghost so the throw scores where it actually scored. Absent on old
   * recordings - inferRecordingTier guesses from the ball look.
   */
  tierId?: number;
  playerSamples: FrameSample[];
  ballSamples: BallSample[];
  outcomeT?: number; //  when the hit/miss happened (recording time)
  made?: boolean;
  /** when the thrower CAUGHT the missed ball back (recording time) -
   *  the replay pops the ball and celebrates there */
  catchT?: number;
  // teleport slam context: the zapp moment and both ends of the jump
  teleportT?: number;
  teleportFrom?: { x: number; d: number; h: number };
  teleportTo?: { x: number; d: number; h: number };
  duration?: number; //  outcomeT + postRollS, set when finalized
  done: boolean;
  evicted: boolean; //   samples dropped to bound memory - unplayable
}

/**
 * The tier a recording was made at. Explicit stamps win; legacy
 * recordings only carry the ball look, and "classic" balls only ever
 * existed at tier 1 - "red" is ambiguous (tier 2 or 3), so those replay
 * without a ghost hoop (null) rather than guess wrong.
 */
export function inferRecordingTier(rec: ThrowRecording): number | null {
  if (rec.tierId !== undefined) return rec.tierId;
  if ((rec.ballLook ?? "classic") === "classic") return 1;
  return null;
}

const lin = (a: number, b: number, f: number) => a + (b - a) * f;

/** Linear interpolation over a time-sorted sample array. */
export function sampleAt<S extends { t: number }>(
  arr: S[],
  t: number,
  lerp: (a: S, b: S, f: number) => S,
): S | null {
  if (arr.length === 0 || t < arr[0].t) return null;
  if (t >= arr[arr.length - 1].t) return arr[arr.length - 1];
  // arrays are a few hundred entries; a scan is fine at 60fps
  let i = 0;
  while (arr[i + 1].t < t) i++;
  const a = arr[i];
  const b = arr[i + 1];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return lerp(a, b, f);
}

export const lerpFrame = (
  a: FrameSample,
  b: FrameSample,
  f: number,
): FrameSample => {
  const near = f < 0.5 ? a : b;
  return {
    t: 0,
    x: lin(a.x, b.x, f),
    d: lin(a.d, b.d, f),
    airH: lin(a.airH, b.airH, f),
    facing: near.facing,
    angle: lin(a.angle, b.angle, f),
    pose: lerpPoseState(a.pose, b.pose, f),
    orb: near.orb,
    bubble: near.bubble,
  };
};

export const lerpBall = (a: BallSample, b: BallSample, f: number): BallSample => ({
  t: 0,
  x: lin(a.x, b.x, f),
  d: lin(a.d, b.d, f),
  h: lin(a.h, b.h, f),
});
