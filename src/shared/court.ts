import { BALANCE } from "./config";

// Court landmarks & clamps in METERS — the world model shared by client
// and server. Dependency-free. (The client's px render mapping lives in
// src/world.ts, which re-exports this module.)
//
// A point on the court is (x, d, h):
//   x: distance along the court, 0 = left baseline, grows toward the hoop
//   d: depth across the floor band, 0 = far sideline, grows toward the viewer
//   h: height above the floor

export const RIM = {
  x: BALANCE.court.lengthM - BALANCE.court.rimFromBaselineM,
  d: BALANCE.court.depthM / 2, // the hoop's lane sits mid-band
  h: BALANCE.hoop.rimHeightM,
  r: BALANCE.hoop.rimRadiusM,
};

export const THREE_PT_X = RIM.x - BALANCE.court.threePtM;
export const FREE_THROW_X = RIM.x - BALANCE.court.freeThrowM;

// boundary walls, offset past both baselines (meters)
export const WALL_LEFT_X = -BALANCE.wall.offsetPx / BALANCE.court.meterPx;
export const WALL_RIGHT_X =
  BALANCE.court.lengthM + BALANCE.wall.offsetPx / BALANCE.court.meterPx;

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
    x: clamp(x, BALANCE.move.minXM, RIM.x - BALANCE.move.hoopStandoffM),
    d: clamp(d, 0, BALANCE.court.depthM),
  };
}

/**
 * Where a joining player appears: a random spot inside a spawnAreaM
 * square sitting just outside the hoop's keep-out zone, centered on the
 * rim lane. Rolled by the AUTHORITY (server Room / LocalBackend) so every
 * client sees the player in the same place. `rand` injected for tests.
 */
export function rollSpawn(rand: () => number = Math.random) {
  const zoneEdge = RIM.x - BALANCE.move.hoopStandoffM;
  const size = BALANCE.move.spawnAreaM;
  return clampToCourt(
    zoneEdge - rand() * size,
    RIM.d - size / 2 + rand() * size,
  );
}

/**
 * Where a player lands when an upgrade fires: a random spot in a band
 * well clear of the hoop (BALANCE.upgrade — PLACEHOLDER band), giving
 * the transformation room to play. Rolled by the AUTHORITY, like spawns.
 */
export function rollUpgradeClearSpot(rand: () => number = Math.random) {
  const u = BALANCE.upgrade;
  return clampToCourt(
    u.clearMinXM + rand() * (u.clearMaxXM - u.clearMinXM),
    0.5 + rand() * (BALANCE.court.depthM - 1),
  );
}
