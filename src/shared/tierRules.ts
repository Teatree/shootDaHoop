// ════════════════════════════════════════════════════════════════════
//  TIER RULES — pure selectors that FOLD the tier recipes (shared/
//  tiers.ts) into the live gameplay values the engine runs on: hoop
//  geometry, throw power, looks, orb timing, unlock checks.
//
//  Shared by the server (validation + resolution), the LocalBackend
//  (offline authority) and the client (rendering + feel), so every
//  authority derives the SAME rules from the same data.
//
//  Dependency-free: no Phaser, no DOM, no Node.
// ════════════════════════════════════════════════════════════════════

import { BALANCE } from "./config";
import { RIM } from "./court";
import { HOOP_TIERS, type HoopTierDef } from "./tiers";
import type {
  BallLookId,
  CourtLookId,
  DoubleHoopSpec,
  FxKind,
  HoopChange,
  InteractiveElement,
} from "./tierChanges";

// ── Tier lookups & the unlock check ──────────────────────────────────

export function getTier(tierId: number): HoopTierDef | undefined {
  return HOOP_TIERS.find((t) => t.id === tierId);
}

/** The tier an upgrade would unlock next, or null at the ladder's top. */
export function nextTier(tierId: number): HoopTierDef | null {
  return getTier(tierId + 1) ?? null;
}

/** Threshold met → the "Upgrade" button may appear and a press is valid. */
export function canUpgrade(w: { sharedScore: number; tierId: number }): boolean {
  const next = nextTier(w.tierId);
  return next !== null && w.sharedScore >= next.threshold;
}

/** Tiers 1..tierId in play order — effects accumulate across them. */
function tiersUpTo(tierId: number): HoopTierDef[] {
  return HOOP_TIERS.filter((t) => t.id <= tierId);
}

// ── Hoop geometry ─────────────────────────────────────────────────────
// The physics, renderer, camera and server validation all consume this
// one shape; a tier with different geometry "just works" everywhere.

export interface RimSpec {
  id: "main" | "upper" | "lower";
  x: number; // rim center, court meters
  h: number; // rim height above the floor
  r: number; // rim opening half-width
}

export interface HoopGeometry {
  /** every hittable rim, top-most first */
  rims: RimSpec[];
  boardX: number; //      backboard face plane
  boardTopM: number; //   backboard vertical extent
  boardBottomM: number;
}

const geomCache = new Map<number, HoopGeometry>();

export function hoopGeometryForTier(tierId: number): HoopGeometry {
  const hit = geomCache.get(tierId);
  if (hit) return hit;

  // fold every hoop-change from tier 1 up: scales are relative to the
  // PREVIOUS tier, so they multiply
  let heightK = 1;
  let rimR = BALANCE.hoop.rimRadiusM;
  let dbl: DoubleHoopSpec | null = null;
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes)
      if (c.type === "hoop-change") {
        heightK *= c.heightScale ?? 1;
        rimR *= c.rimWidthScale ?? 1;
        if (c.doubleHoop) dbl = c.doubleHoop;
      }

  // the board's extent tracks the rims it serves, scaled like the hoop
  const topH = BALANCE.hoop.rimHeightM * heightK;
  const belowM = (BALANCE.hoop.rimHeightM - BALANCE.hoop.boardBottomM) * heightK;
  const aboveM = (BALANCE.hoop.boardTopM - BALANCE.hoop.rimHeightM) * heightK;

  let geom: HoopGeometry;
  if (!dbl) {
    const rim: RimSpec = { id: "main", x: RIM.x, h: topH, r: rimR };
    geom = {
      rims: [rim],
      boardX: rim.x + rim.r + BALANCE.hoop.boardGapM,
      boardBottomM: rim.h - belowM,
      boardTopM: rim.h + aboveM,
    };
  } else {
    const lower: RimSpec = {
      id: "lower",
      x: RIM.x,
      h: topH - dbl.gapM,
      r: rimR * dbl.lower.rScale,
    };
    const upperR = rimR * dbl.upper.rScale;
    const upper: RimSpec = {
      id: "upper",
      // the upper rim's FRONT (left) tip protrudes further out than the
      // lower's front tip — this is what enables the double shot
      x: lower.x - lower.r - dbl.upper.protrudeLeftPx / BALANCE.court.meterPx + upperR,
      h: topH,
      r: upperR,
    };
    geom = {
      rims: [upper, lower],
      boardX: Math.max(upper.x + upper.r, lower.x + lower.r) + BALANCE.hoop.boardGapM,
      boardBottomM: lower.h - belowM,
      boardTopM: upper.h + aboveM,
    };
  }
  geomCache.set(tierId, geom);
  return geom;
}

// ── Throw power (Permanent Effect: ball-range) ────────────────────────

export interface PowerCurve {
  minPowerM: number;
  maxPowerM: number;
}

/** "Balls travel X% further" scales launch SPEED by √X — flight range on
 *  flat ground grows with v², so this lands exactly on the doc's +25%. */
export function effectivePowerForTier(tierId: number): PowerCurve {
  let travelK = 1;
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes)
      if (c.type === "permanent-effect" && c.effect === "ball-range")
        travelK *= c.travelScale;
  const speedK = Math.sqrt(travelK);
  return {
    minPowerM: BALANCE.power.minPowerM * speedK,
    maxPowerM: BALANCE.power.maxPowerM * speedK,
  };
}

// ── Looks (ball skin, court skin) ─────────────────────────────────────

export function ballLookForTier(tierId: number): BallLookId {
  let look: BallLookId = "classic";
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes)
      if (c.type === "permanent-effect") look = c.ballLook;
  return look;
}

export function courtLookForTier(tierId: number): CourtLookId {
  let look: CourtLookId = "standard";
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes)
      if (c.type === "scene-visual" && c.target === "court-floor") look = c.look;
  return look;
}

// ── Interactive elements & unlocked animations (cumulative) ───────────

export function interactivesForTier(tierId: number): InteractiveElement[] {
  const out: InteractiveElement[] = [];
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes) if (c.type === "interactive") out.push(c);
  return out;
}

export function animationsForTier(tierId: number): Set<string> {
  const out = new Set<string>();
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes) if (c.type === "new-animation") out.add(c.anim);
  return out;
}

// ── Orb timing (Ambient / Spawn Change) ───────────────────────────────

export interface OrbTiming {
  minCadenceS: number;
  maxCadenceS: number;
  lifeS: number;
  appearFx: FxKind;
}

/** Defaults to today's fixed cadence (BALANCE.orb); an ambient-spawn
 *  change overrides it from its tier onward. */
export function orbTimingForTier(tierId: number): OrbTiming {
  let timing: OrbTiming = {
    minCadenceS: BALANCE.orb.cadenceS,
    maxCadenceS: BALANCE.orb.cadenceS,
    lifeS: BALANCE.orb.lifeS,
    appearFx: "pop",
  };
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes)
      if (c.type === "ambient-spawn" && c.object === "orb")
        timing = {
          minCadenceS: c.cadence.minS,
          maxCadenceS: c.cadence.maxS,
          lifeS: c.lifeS,
          appearFx: c.appearFx,
        };
  return timing;
}

// ── Recipe helpers for the choreography player ────────────────────────

export function hoopChangeForTier(tierId: number): HoopChange | null {
  const t = getTier(tierId);
  if (!t) return null;
  for (const c of t.changes) if (c.type === "hoop-change") return c;
  return null;
}
