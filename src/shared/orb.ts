import { BALANCE } from "./config";
import { RIM } from "./court";

// The teleport orb as DATA + pure rules - no Phaser, no Node. This is the
// shared half of a SERVER-AUTHORITATIVE WORLD OBJECT: the authority (the
// server Room in multiplayer, LocalBackend offline) rolls spawns, owns the
// expiry clock and decides consumption; every client just renders the
// state it is told. The hoop score / tier follows the same pattern via
// WorldState. Add future server objects the same way: state shape +
// pure rules here, lifecycle in the authority, rendering in the scene.

export interface OrbState {
  seq: number; // monotonically increasing per world - dedupes remove/spawn races
  x: number; //  court meters
  d: number;
  h: number;
}

/** Roll a spawn position. `rand` is injected so tests can pin it. */
export function rollOrbSpawn(seq: number, rand: () => number = Math.random): OrbState {
  const zoneEdgeM = RIM.x - BALANCE.move.hoopStandoffM;
  return {
    seq,
    x: zoneEdgeM - rand() * BALANCE.orb.rangeXM,
    d: RIM.d,
    h: BALANCE.hoop.rimHeightM + BALANCE.orb.aboveHoopM + rand() * BALANCE.orb.rangeHM,
  };
}

/** Ball-vs-orb overlap - the ONE hit rule, used by client feel and server ruling. */
export function orbHitTest(
  orb: OrbState,
  bx: number,
  bd: number,
  bh: number,
): boolean {
  if (Math.abs(bd - orb.d) > BALANCE.orb.hitDepthM) return false;
  const hitR = BALANCE.orb.radiusM + BALANCE.throw.ballRadiusM;
  return Math.hypot(bx - orb.x, bh - orb.h) <= hitR;
}
