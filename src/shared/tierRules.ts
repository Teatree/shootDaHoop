// ════════════════════════════════════════════════════════════════════
//  TIER RULES - pure selectors that FOLD the tier recipes (shared/
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
import { RIM, clampToCourt } from "./court";
import { HOOP_TIERS, type HoopTierDef } from "./tiers";
import type {
  BallLookId,
  CourtLookId,
  DoubleHoopSpec,
  FxKind,
  HoopChange,
  HoopLook,
  InteractiveElement,
  SunMood,
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

/** Tiers 1..tierId in play order - effects accumulate across them. */
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

/** The folded hoop parameters at some point of the ladder (or mid-beat). */
interface HoopFold {
  heightK: number; //  cumulative height scale over the tier-1 hoop
  rimR: number; //     folded single-rim opening half-width
  dbl: DoubleHoopSpec | null;
  /** "upper-only" is the mid-choreography stage where the upper rim has
   *  jutted forward but the lower hasn't appeared yet */
  dblStage: "none" | "upper-only" | "full";
}

/** Fold every hoop-change of tiers 1..tierId: scales are relative to the
 *  PREVIOUS tier, so they multiply. */
function foldHoop(tierId: number): HoopFold {
  const f: HoopFold = {
    heightK: 1,
    rimR: BALANCE.hoop.rimRadiusM,
    dbl: null,
    dblStage: "none",
  };
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes)
      if (c.type === "hoop-change") {
        f.heightK *= c.heightScale ?? 1;
        f.rimR *= c.rimWidthScale ?? 1;
        if (c.doubleHoop) {
          f.dbl = c.doubleHoop;
          f.dblStage = "full";
        }
      }
  return f;
}

function buildGeometry(f: HoopFold): HoopGeometry {
  // the board's extent tracks the rims it serves, scaled like the hoop
  const topH = BALANCE.hoop.rimHeightM * f.heightK;
  const belowM =
    (BALANCE.hoop.rimHeightM - BALANCE.hoop.boardBottomM) * f.heightK;
  const aboveM =
    (BALANCE.hoop.boardTopM - BALANCE.hoop.rimHeightM) * f.heightK;

  if (!f.dbl || f.dblStage === "none") {
    const rim: RimSpec = { id: "main", x: RIM.x, h: topH, r: f.rimR };
    return {
      rims: [rim],
      boardX: rim.x + rim.r + BALANCE.hoop.boardGapM,
      boardBottomM: rim.h - belowM,
      boardTopM: rim.h + aboveM,
    };
  }
  const dbl = f.dbl;
  const lowerR = f.rimR * dbl.lower.rScale;
  const lowerX = RIM.x;
  const lowerH = topH - dbl.gapM;
  const upperR = f.rimR * dbl.upper.rScale;
  // "one rim with its net" = the lower rim's stroke (~5 px in the
  // renderer) plus its hanging net (the renderer draws it 2×r deep) -
  // the raise unit for rimNetsAboveLower (owner 2026-07-15: the upper
  // rim sits 2 of these above the LOWER rim; the board does not follow)
  const rimNetM = 5 / BALANCE.court.meterPx + 2 * lowerR;
  const upper: RimSpec = {
    id: "upper",
    // the upper rim's FRONT (left) tip protrudes further out than the
    // lower's front tip - this is what enables the double shot
    x: lowerX - lowerR - dbl.upper.protrudeLeftPx / BALANCE.court.meterPx + upperR,
    h: dbl.upper.rimNetsAboveLower !== undefined
      ? lowerH + dbl.upper.rimNetsAboveLower * rimNetM
      : topH,
    r: upperR,
  };
  if (f.dblStage === "upper-only") {
    // mid-choreography: the upper has jutted forward, the lower is yet
    // to splash in beneath (presentation only - live physics runs on
    // the FULL tier geometry from the moment the upgrade fires)
    return {
      rims: [upper],
      boardX: Math.max(upper.x + upper.r, lowerX + lowerR) + BALANCE.hoop.boardGapM,
      boardBottomM: topH - belowM,
      boardTopM: topH + aboveM,
    };
  }
  const lower: RimSpec = { id: "lower", x: lowerX, h: lowerH, r: lowerR };
  return {
    rims: [upper, lower],
    boardX: Math.max(upper.x + upper.r, lower.x + lower.r) + BALANCE.hoop.boardGapM,
    boardBottomM: lower.h - belowM,
    boardTopM: topH + aboveM,
  };
}

const geomCache = new Map<number, HoopGeometry>();

export function hoopGeometryForTier(tierId: number): HoopGeometry {
  let geom = geomCache.get(tierId);
  if (!geom) {
    geom = buildGeometry(foldHoop(tierId));
    geomCache.set(tierId, geom);
  }
  return geom;
}

/**
 * The hoop's look AFTER each beat of a tier's upgrade choreography - one
 * geometry per entry of the hoop change's `choreo` array ("wait" beats
 * keep the previous look). The choreography player rebuilds the visual
 * hoop through these stages while the LIVE geometry is already the full
 * tier (players are teleported clear, so nothing meaningful can be
 * thrown at a half-built hoop).
 */
export function hoopChoreoGeometries(tierId: number): HoopGeometry[] {
  const change = hoopChangeForTier(tierId);
  if (!change) return [];
  const prev = foldHoop(tierId - 1);
  const f: HoopFold = { ...prev };
  const out: HoopGeometry[] = [];
  for (const beat of change.choreo) {
    switch (beat.beat) {
      case "grow-taller":
        f.heightK = prev.heightK * (change.heightScale ?? 1);
        break;
      case "widen-rim":
        f.rimR = prev.rimR * (change.rimWidthScale ?? 1);
        break;
      case "upper-juts-forward":
        if (change.doubleHoop) {
          f.dbl = change.doubleHoop;
          f.dblStage = "upper-only";
        }
        break;
      case "lower-appears":
        f.dblStage = "full";
        break;
      case "wait":
        break;
    }
    out.push(buildGeometry(f));
  }
  return out;
}

// ── Hoop look (the paint job repaints with each hoop change) ──────────

/** Tier 1's paint: cream board, orange rim, gray pole - today's hoop. */
const BASE_HOOP_LOOK: HoopLook = {
  board: 0xf6ead2,
  boardEdge: 0x8a6a4a,
  rim: 0xe86a3a,
  pole: 0x6a6a72,
};

export function hoopLookForTier(tierId: number): HoopLook {
  let look = BASE_HOOP_LOOK;
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes)
      if (c.type === "hoop-change" && c.look) look = c.look;
  return look;
}

// ── Throw power (Permanent Effect: ball-range) ────────────────────────

export interface PowerCurve {
  minPowerM: number;
  maxPowerM: number;
}

/** "Balls travel X% further" scales launch SPEED by √X - flight range on
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

/** The cheer deck at this tier, or null before it exists (Hoop 2+). */
export function cheerDeckForTier(tierId: number): InteractiveElement | null {
  return (
    interactivesForTier(tierId).find((el) => el.element === "cheer-area") ??
    null
  );
}

/**
 * The standing spots of an occupiable element - ONE formula shared by
 * the client's cheer errand and the server's offline seating, so a
 * statue the server parks lands exactly on a client spot (and the
 * remote avatars' on-deck check lights up the weary cheer).
 */
export function interactiveSpots(
  el: InteractiveElement,
): { x: number; d: number }[] {
  const n = el.spots ?? 3;
  const span = el.widthM * 0.7;
  return Array.from({ length: n }, (_, i) => ({
    x: el.placement.xM - span / 2 + (span * i) / Math.max(1, n - 1),
    d: el.placement.dM,
  }));
}

export function animationsForTier(tierId: number): Set<string> {
  const out = new Set<string>();
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes) if (c.type === "new-animation") out.add(c.anim);
  return out;
}

/**
 * Where a character may STAND at this tier: the court, plus any unlocked
 * interactive area that characters physically occupy (the cheer deck).
 * The server's pose sanitizer uses this so remote cheerers aren't
 * snapped back onto the court.
 *
 * `zoneOpen` = the Upgrade button is available: pressing it means
 * walking THROUGH the hoop's keep-out zone to touch the hoop, so while
 * an upgrade is up the zone admits characters (up to the hoop itself).
 */
export function clampToWalkable(
  x: number,
  d: number,
  tierId: number,
  zoneOpen = false,
): { x: number; d: number } {
  for (const el of interactivesForTier(tierId)) {
    if (!el.occupiesSpot) continue;
    const slack = 0.3; // a little grace around the footprint
    if (
      Math.abs(x - el.placement.xM) <= el.widthM / 2 + slack &&
      Math.abs(d - el.placement.dM) <= el.depthM / 2 + slack
    )
      return { x, d };
  }
  const c = clampToCourt(x, d);
  if (zoneOpen && x > c.x) {
    return { x: Math.min(x, RIM.x), d: c.d };
  }
  return c;
}

// ── Atmosphere (camera tint + sun mood) ───────────────────────────────

export interface Atmosphere {
  overlay: { color: number; alpha: number };
  sun: SunMood;
  /** the sky's own colour (the camera background) */
  sky: number;
}

/** Tier 1's sky exactly as it is today: no tint, warm suns, base pace.
 *  The sky colour matches the game config's backgroundColor (main.ts). */
export const BASE_ATMOSPHERE: Atmosphere = {
  overlay: { color: 0x000000, alpha: 0 },
  sun: {
    coreColor: 0xffe08a,
    glowColor: 0xfff0c0,
    sizeScale: 1,
    speedScale: 1,
    pulsate: false,
  },
  sky: 0xf9e3b8,
};

/** Last-wins fold, like the court skin - a reset restores the base sky.
 *  A change without `sky` keeps the previous tier's sky colour. */
export function atmosphereForTier(tierId: number): Atmosphere {
  let atm = BASE_ATMOSPHERE;
  for (const t of tiersUpTo(tierId))
    for (const c of t.changes)
      if (c.type === "atmosphere")
        atm = { overlay: c.overlay, sun: c.sun, sky: c.sky ?? atm.sky };
  return atm;
}

// ── Orb timing (Ambient / Spawn Change) ───────────────────────────────

export interface OrbTiming {
  minCadenceS: number;
  maxCadenceS: number;
  lifeS: number;
  appearFx: FxKind;
}

/** The orb exists ONLY once a tier's ambient-spawn change introduces it
 *  (owner 2026-07-16: Hoop 3) - null below that means NO orb spawns.
 *  (It previously defaulted to a fixed BALANCE.orb cadence at every
 *  tier; BALANCE.orb still holds the orb's size/height/physics.) */
export function orbTimingForTier(tierId: number): OrbTiming | null {
  let timing: OrbTiming | null = null;
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
