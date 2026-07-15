import { T } from "./tuning";

// CLIENT render mapping: court meters → world pixels. The court model
// itself (landmarks, walls, clamps - all in meters) is shared with the
// server and lives in src/shared/court.ts; re-exported here so client code
// keeps one import site.

export {
  RIM,
  THREE_PT_X,
  FREE_THROW_X,
  WALL_LEFT_X,
  WALL_RIGHT_X,
  clamp,
  clampToCourt,
  floorDistToRim,
} from "./shared/court";

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

/** Render depth for painter's ordering - nearer (bigger d) draws on top. */
export function sortDepth(d: number): number {
  return 100 + d * 10;
}
