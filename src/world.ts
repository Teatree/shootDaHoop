import { T } from "./tuning";

// NOTE: this module is intentionally Phaser-free (pure math) so unit tests
// can import it without booting the engine.

// World model: a point on the court is (x, d, h) in METERS —
//   x: distance along the court, 0 = left baseline, grows toward the hoop
//   d: depth across the floor band, 0 = far sideline, grows toward the viewer
//   h: height above the floor
// Rendering maps that to side-view world pixels.

export const M = T.court.meterPx;

/** World-px Y of the floor at a given depth. */
export function floorY(d: number): number {
  return T.court.floorBaseY + d * T.court.depthPxPerM;
}

/** Full world→screen mapping (world px, before camera). */
export function toScreen(x: number, d: number, h: number) {
  return { sx: x * M, sy: floorY(d) - h * M };
}

/** Inverse: a click on the floor plane (world px) → court (x, d). */
export function screenToFloor(sx: number, sy: number) {
  const x = sx / M;
  const d = (sy - T.court.floorBaseY) / T.court.depthPxPerM;
  return { x, d };
}

/** Render depth for painter's ordering — nearer (bigger d) draws on top. */
export function sortDepth(d: number): number {
  return 100 + d * 10;
}

// ── Fixed landmarks ──────────────────────────────────────────────────

export const RIM = {
  x: T.court.lengthM - T.court.rimFromBaselineM,
  d: T.court.depthM / 2, // the hoop's lane sits mid-band
  h: T.hoop.rimHeightM,
  r: T.hoop.rimRadiusM,
};

export const THREE_PT_X = RIM.x - T.court.threePtM;
export const FREE_THROW_X = RIM.x - T.court.freeThrowM;

// boundary walls, offset past both baselines (meters)
export const WALL_LEFT_X = -T.wall.offsetPx / M;
export const WALL_RIGHT_X = T.court.lengthM + T.wall.offsetPx / M;

/** Floor distance (court meters) from a standing spot to the rim base. */
export function floorDistToRim(x: number, d: number): number {
  const dx = x - RIM.x;
  const dd = (d - RIM.d) * 1; // depth counts at full weight
  return Math.sqrt(dx * dx + dd * dd);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clampToCourt(x: number, d: number) {
  return {
    x: clamp(x, T.move.minXM, RIM.x - T.move.hoopStandoffM),
    d: clamp(d, 0, T.court.depthM),
  };
}
