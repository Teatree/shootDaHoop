// Ball types — DATA-DRIVEN: a ball is a data entry, so the later per-player
// ball progression is a content change, not a code change. Dependency-free.
//
// NOTE: today the whole sim runs on one active type (BALANCE.throw reads the
// default's radius). Threading a per-throw ball type through the physics is
// deliberately deferred to the ball-progression feature; this file is the
// surface it will land on.

export interface BallTypeDef {
  id: string;
  label: string;
  radiusM: number;
  /** future per-ball feel hooks (restitution multipliers, trail skin, …) */
}

export const BALL_TYPES = {
  standard: {
    id: "standard",
    label: "Street ball",
    radiusM: 0.36,
  },
} as const satisfies Record<string, BallTypeDef>;

export type BallTypeId = keyof typeof BALL_TYPES;

export const DEFAULT_BALL: BallTypeId = "standard";
