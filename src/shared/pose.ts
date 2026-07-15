// The character pose model - PURE math, no Phaser, so the same function
// drives the local player, remote avatars (from streamed telemetry) and
// ghost replays, and unit tests can pin the animation contract.
//
// Space conventions: offsets are pixels in FACING-RIGHT space with +y UP
// from the feet; the rig mirrors the whole figure for left-facing and
// converts to screen-y. Rotation is used only for whole-figure tilt -
// tiny pixel art shears badly under per-part rotation, so every limb
// motion here is positional.

export type PoseKind =
  | "idle"
  | "walk"
  | "aim"
  | "throw"
  | "fall"
  | "lie"
  | "getup"
  | "cheer" // unlocked with Hoop 2 (shared/tiers.ts New Animation)
  | "point" //    out of balls: the front arm tracks the aim, no trail
  | "airpunch"; // …and releasing punches the air (t = 0..1 progress)

export interface PoseState {
  kind: PoseKind;
  /**
   * The kind's clock: walk = accumulated walk time (s), throw = 0..1
   * progress, fall/lie = seconds in state. idle/aim/getup ignore it.
   */
  t: number;
  /** aim/throw: launch direction, radians (0 = toward the hoop, + = up) */
  aimAngle?: number;
  /** aim/throw: 0..1 charge - hands pull back slingshot-style with power */
  aimPower?: number;
  /** cheer: the tired AFK variant - head hangs a little (the SPEED of a
   *  weary cheer is the caller's job: advance `t` at WEARY_CHEER_RATE) */
  weary?: boolean;
}

export interface V2 {
  x: number;
  y: number;
}

/** Where each part sits at rest, relative to the feet centre (+y up). */
export const PART_ANCHORS = {
  lower: { x: 0, y: 6 }, //  the trouser band, 12px tall on the floor
  upper: { x: 0, y: 26 }, // shirt tucks INTO the band (drawn under it)
  head: { x: 1, y: 49 }, //  crown at ~64, beard brushing the shirt top
  handL: { x: -20, y: 21 }, // hanging low at the sides (owner-tuned)
  handR: { x: 20, y: 21 },
} as const;

/** Assembled figure height in px (feet → crown of the raised head). */
export const FIGURE_H = 64;

export interface RigPose {
  /** per-part offsets FROM their PART_ANCHORS */
  lower: V2;
  upper: V2;
  head: V2;
  handL: V2;
  handR: V2;
  /** whole-figure lean in degrees (+ = toppling toward facing) */
  tilt: number;
  /** held-ball centre relative to the feet, or null = nothing in hand */
  ball: V2 | null;
}

const ZERO: V2 = { x: 0, y: 0 };
const IDLE: RigPose = {
  lower: ZERO,
  upper: ZERO,
  head: ZERO,
  handL: ZERO,
  handR: ZERO,
  tilt: 0,
  ball: null,
};

// walk feel - bob matches the old single-sprite character exactly
const BOB_HZ = 9; //        rad/s inside sin() (the prototype's value)
const BOB_PX = 3;
const SWING_PX = 5; //      hand swing amplitude, forward/back
const SWING_LIFT_PX = 1.5; // hands rise slightly at the swing extremes
const WALK_TILT = 2.5; //   lean into the walk, degrees

// aim/throw geometry
const HOLD_BASE: V2 = { x: 6, y: 72 }; // ball hold clear above the crown (~64)
const PULLBACK_PX = 8; //   full-power slingshot pull, against the aim dir
const AIM_CROUCH = 2; //    the old stance crouch, whole figure
const AIM_TILT_MAX = -5; // lean back while charging, degrees
const THROW_REACH = 14; //  follow-through hand extension along the aim
const THROW_TILT = 8; //    follow-through forward lean, degrees

// falling - both hands straight up ("wheee"), waggling slightly.
// ABSOLUTE feet-relative position (like the aim hold), so moving the
// resting hand anchors can never drag the raised hands down again.
const HANDS_UP: V2 = { x: 8, y: 68 }; // beside and just above the crown
const WAGGLE_HZ = 12;
const WAGGLE_PX = 1.5;

// pointing / air-punching - the out-of-balls aim: the FRONT hand (handL,
// drawn over the body) extends from the shoulder along the aim direction;
// the punch jabs it further out and snaps back. PLACEHOLDER (tune).
const POINT_SHOULDER: V2 = { x: 4, y: 44 }; // arm origin, feet-relative
const POINT_REACH = 24; //  arm extension while pointing
const PUNCH_EXTRA = 12; //  extra reach at the punch's peak
const PUNCH_TILT = 4; //    forward lean at the peak, degrees

// cheering - bob and throw the hands in the air in a QUICK rhythm
// (Hoop 2's New Animation). Hands pump between shoulder height and full
// stretch, slightly out of phase so it reads alive, not robotic.
const CHEER_HZ = 2.4; //     pumps per second - 20% slower per owner feedback 2026-07-14
const CHEER_BOB_PX = 4; //   body hop per pump
const CHEER_LOW_Y = 42; //   hands at the pump's bottom (shoulder-ish)
const CHEER_PHASE = 0.55; // right hand trails the left by this (radians)

// the AFK cheer (owner ask 2026-07-15): an abandoned character standing
// on the deck cheers along, but reads tired - the clock runs slower and
// the head hangs. The owner said "30%" in one line and "40%" in the
// refining sub-point; the sub-point wins.
// PLACEHOLDER (tune): 40% slower → the cheer clock advances at ×0.6
export const WEARY_CHEER_RATE = 0.6;
// PLACEHOLDER (tune): how far the weary head droops, px
const WEARY_HEAD_DROP_PX = 5;

const smoothOut = (t: number) => 1 - (1 - t) * (1 - t);

/** The single source of truth: a pose state → where every part sits. */
export function computePose(s: PoseState): RigPose {
  switch (s.kind) {
    case "idle":
      return IDLE;

    case "walk": {
      const swing = Math.sin(s.t * BOB_HZ);
      const bob = Math.abs(swing) * BOB_PX;
      // hands arc: lowest mid-stride, lifting a little at each extreme
      const lift = Math.abs(swing) * SWING_LIFT_PX;
      return {
        lower: { x: 0, y: bob },
        upper: { x: 0, y: bob },
        head: { x: 0, y: bob },
        handL: { x: swing * SWING_PX, y: bob + lift },
        handR: { x: -swing * SWING_PX, y: bob + lift },
        tilt: WALK_TILT,
        ball: null,
      };
    }

    case "aim": {
      const { hold, dir, p } = holdPoint(s);
      return {
        lower: { x: 0, y: -AIM_CROUCH },
        upper: { x: 0, y: -AIM_CROUCH },
        head: { x: 1, y: 1 - AIM_CROUCH }, // looking up at the ball
        handL: off("handL", { x: hold.x - 6, y: hold.y - 1 - AIM_CROUCH }),
        handR: off("handR", { x: hold.x + 6, y: hold.y - AIM_CROUCH }),
        tilt: AIM_TILT_MAX * p,
        ball: { x: hold.x + dir.x * 4, y: hold.y + dir.y * 4 - AIM_CROUCH },
      };
    }

    case "throw": {
      const { hold, dir, p } = holdPoint(s);
      const e = smoothOut(clamp01(s.t));
      const crouch = AIM_CROUCH * (1 - e); // rise out of the aim crouch
      // hands sweep from the charged hold to full extension along the aim
      const hx = hold.x + (HOLD_BASE.x + dir.x * THROW_REACH - hold.x) * e;
      const hy =
        hold.y - crouch + (HOLD_BASE.y + dir.y * THROW_REACH - hold.y) * e;
      return {
        lower: { x: 0, y: -crouch },
        upper: { x: e * 2, y: -crouch },
        head: { x: 1 + e * 2, y: 1 - crouch },
        handL: off("handL", { x: hx - 6, y: hy - 1 }),
        handR: off("handR", { x: hx + 6, y: hy }),
        tilt: AIM_TILT_MAX * p + (THROW_TILT - AIM_TILT_MAX * p) * e,
        ball: null, // the real ball is already flying
      };
    }

    case "fall": {
      const wig = Math.sin(s.t * WAGGLE_HZ) * WAGGLE_PX;
      return handsUpPose(wig);
    }

    case "lie":
    case "getup":
      // hands STAY up while face-down and while getting up - they only
      // come down once the figure is fully upright (kind returns to idle)
      return handsUpPose(0);

    case "point": {
      const dir = pointDir(s);
      return {
        lower: ZERO,
        upper: ZERO,
        head: { x: 2, y: 1 }, // looking along the arm
        handL: off("handL", {
          x: POINT_SHOULDER.x + dir.x * POINT_REACH,
          y: POINT_SHOULDER.y + dir.y * POINT_REACH,
        }),
        handR: ZERO,
        tilt: 0,
        ball: null,
      };
    }

    case "airpunch": {
      const dir = pointDir(s);
      const jab = Math.sin(Math.PI * clamp01(s.t)); // out and back
      const reach = POINT_REACH + PUNCH_EXTRA * jab;
      return {
        lower: ZERO,
        upper: { x: jab * 2, y: 0 },
        head: { x: 2 + jab * 2, y: 1 },
        handL: off("handL", {
          x: POINT_SHOULDER.x + dir.x * reach,
          y: POINT_SHOULDER.y + dir.y * reach,
        }),
        handR: ZERO,
        tilt: PUNCH_TILT * jab,
        ball: null,
      };
    }

    case "cheer": {
      const ph = s.t * Math.PI * 2 * CHEER_HZ;
      const pumpL = (Math.sin(ph) + 1) / 2; //             0..1
      const pumpR = (Math.sin(ph - CHEER_PHASE) + 1) / 2;
      const bob = Math.abs(Math.sin(ph)) * CHEER_BOB_PX;
      const handY = (p: number) => CHEER_LOW_Y + p * (HANDS_UP.y - CHEER_LOW_Y);
      // the weary (AFK) cheer hangs its head a little - tiredness
      const droop = s.weary ? WEARY_HEAD_DROP_PX : 0;
      return {
        lower: { x: 0, y: bob * 0.5 },
        upper: { x: 0, y: bob * 0.7 },
        head: { x: 0, y: bob - droop },
        handL: off("handL", { x: -HANDS_UP.x - 2, y: handY(pumpL) + bob }),
        handR: off("handR", { x: HANDS_UP.x + 2, y: handY(pumpR) + bob }),
        tilt: 0,
        ball: null,
      };
    }
  }
}

/**
 * Split a WORLD aim angle into facing + a body-relative (always forward)
 * angle. Aiming backwards turns the character around; π−a preserves the
 * vertical component and flips the horizontal, so the mirrored rig points
 * at the true world direction. This runs BEFORE streaming/recording, so
 * remote observers and ghost replays inherit the flip via `facing`.
 */
export function bodyAim(angle: number): { facing: 1 | -1; aimAngle: number } {
  return Math.cos(angle) >= 0
    ? { facing: 1, aimAngle: angle }
    : { facing: -1, aimAngle: Math.PI - angle };
}

/** The point/punch arm direction from the streamed body-relative angle. */
function pointDir(s: PoseState): V2 {
  const a = s.aimAngle ?? 0.9; // default: the classic 45°-ish launch
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Charged hold point: base position pulled back against the aim dir. */
function holdPoint(s: PoseState) {
  const a = s.aimAngle ?? 0.9; // default: the classic 45°-ish launch
  const p = clamp01(s.aimPower ?? 0);
  const dir = { x: Math.cos(a), y: Math.sin(a) };
  return {
    hold: {
      x: HOLD_BASE.x + dir.x * 3 - dir.x * PULLBACK_PX * p,
      y: HOLD_BASE.y + dir.y * 3 - dir.y * PULLBACK_PX * p,
    },
    dir,
    p,
  };
}

function handsUpPose(wiggle: number): RigPose {
  return {
    lower: ZERO,
    upper: ZERO,
    head: ZERO,
    handL: off("handL", { x: -HANDS_UP.x, y: HANDS_UP.y + wiggle }),
    handR: off("handR", { x: HANDS_UP.x, y: HANDS_UP.y - wiggle }),
    tilt: 0,
    ball: null,
  };
}

/** absolute (feet-relative) target → offset from a part's anchor */
function off(part: keyof typeof PART_ANCHORS, abs: V2): V2 {
  return { x: abs.x - PART_ANCHORS[part].x, y: abs.y - PART_ANCHORS[part].y };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Interpolate two streamed pose states (remote avatars render ~a tick
 * behind and lerp between the samples straddling their render time).
 * Clocks and aim lerp within the same kind; across kinds the nearer
 * sample wins - the rig's own smoothing eases the visual transition.
 */
export function lerpPoseState(
  a: PoseState,
  b: PoseState,
  f: number,
): PoseState {
  if (a.kind !== b.kind) return f < 0.5 ? a : b;
  const lin = (x: number, y: number) => x + (y - x) * f;
  return {
    kind: a.kind,
    t: lin(a.t, b.t),
    aimAngle: lerpMaybe(a.aimAngle, b.aimAngle, f),
    aimPower: lerpMaybe(a.aimPower, b.aimPower, f),
    weary: f < 0.5 ? a.weary : b.weary,
  };
}

function lerpMaybe(a?: number, b?: number, f = 0): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a + (b - a) * f;
}

// ── idle life: breathing + the occasional belly itch ─────────────────
//
// This layer is deliberately LOCAL (rig-side, never streamed): the idle
// pose stays a constant on the wire, and every client animates its own
// standing-around life. Traits are rolled per character so a crowd never
// breathes in sync.

export interface IdleTraits {
  breathHz: number; //  breaths per second (varies per character)
  breathAmp: number; // chest rise, px
}

export function rollIdleTraits(rand: () => number = Math.random): IdleTraits {
  return {
    breathHz: 0.22 + rand() * 0.16, // one breath every ~2.6–4.5 s
    breathAmp: 0.7 + rand() * 0.6,
  };
}

/** Belly-scratch reach and wait: 1–3 minutes between itches. */
export const ITCH_DURATION_S = 1.6;
export function rollItchDelayS(rand: () => number = Math.random): number {
  return 60 + rand() * 120;
}

const BELLY: V2 = { x: 9, y: 24 }; // front-of-shirt scratch spot
const SCRATCH_HZ = 7;

/**
 * The standing-around pose. `itch` is the scratch progress: outside 0..1
 * the hand rests; inside, the FRONT hand (handL - it draws over the body)
 * eases to the belly, scrubs, and eases back.
 */
export function idlePose(t: number, traits: IdleTraits, itch = -1): RigPose {
  const breath =
    Math.sin(t * Math.PI * 2 * traits.breathHz) * traits.breathAmp;
  const hand = { x: 0, y: breath * 0.4 };
  const pose: RigPose = {
    lower: ZERO,
    upper: { x: 0, y: breath * 0.6 },
    head: { x: 0, y: breath },
    handL: hand,
    handR: { ...hand },
    tilt: 0,
    ball: null,
  };
  if (itch >= 0 && itch <= 1) {
    // ease in and out of the reach; scrub while the hand is there
    const reach = Math.min(1, Math.min(itch, 1 - itch) * 4);
    const scrub = Math.sin(t * Math.PI * 2 * SCRATCH_HZ) * 1.8 * reach;
    pose.handL = {
      x: (BELLY.x - PART_ANCHORS.handL.x) * reach + scrub,
      y: (BELLY.y - PART_ANCHORS.handL.y) * reach + breath * 0.4,
    };
  }
  return pose;
}
