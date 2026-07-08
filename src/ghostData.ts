// Ghost record data: sample types + interpolation. Pure (no Phaser) so
// unit tests can drive it, and so a future multiplayer layer can reuse the
// same format as its replication payload.

export interface FrameSample {
  t: number; //  seconds since recording start
  // player
  x: number; //  court meters
  d: number;
  airH: number;
  yOff: number; // walk-bob / aim-crouch pixel offset (pre-baked)
  flipX: boolean;
  angle: number;
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
  playerSamples: FrameSample[];
  ballSamples: BallSample[];
  outcomeT?: number; //  when the hit/miss happened (recording time)
  made?: boolean;
  // teleport slam context: the zapp moment and both ends of the jump
  teleportT?: number;
  teleportFrom?: { x: number; d: number; h: number };
  teleportTo?: { x: number; d: number; h: number };
  duration?: number; //  outcomeT + postRollS, set when finalized
  done: boolean;
  evicted: boolean; //   samples dropped to bound memory — unplayable
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
    yOff: lin(a.yOff, b.yOff, f),
    flipX: near.flipX,
    angle: lin(a.angle, b.angle, f),
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
