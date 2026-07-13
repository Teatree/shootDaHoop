// The typed client↔server vocabulary — ONE file, so a payload-shape
// mismatch is a compile error, not a runtime surprise. Dependency-free;
// imported by the client Backend implementations and the server.

import type { OrbState } from "./orb";
import type { PoseState } from "./pose";

export type { OrbState };
export type { PoseState };

/**
 * Everything needed to draw a character at one instant. Streamed as
 * telemetry (~12 Hz, interpolated on arrival), sampled per-frame into
 * ghost recordings — ONE format for both, by design.
 */
export interface AvatarState {
  x: number; //      court meters
  d: number;
  airH: number; //   feet height above the floor
  facing: 1 | -1; // 1 = facing +x (the hoop); the rig mirrors for -1
  angle: number; //  whole-figure rotation, degrees (the face-plant)
  pose: PoseState;
}

// ── shared shapes ─────────────────────────────────────────────────────

export interface PlayerInfo {
  id: string; //         platform identity (Telegram/Discord user id) or local
  name: string;
  shirtColor: number; // 0xRRGGBB — hard tint on the white t-shirt part
  skinTint: number; //   0xRRGGBB — multiply tint shared by head + hands
  lowerTint: number; //  0xRRGGBB — subtle tint on the trouser band
  headVariant: number; // 1-based index into the head_v* part textures
  x: number; //          court meters (last known/spawn)
  d: number;
}

/** Per-lobby cosmetic identity, rolled client-side on first entry. */
export interface Cosmetics {
  name: string;
  shirtColor: number;
  skinTint: number;
  lowerTint: number;
  headVariant: number;
}

export interface WorldState {
  sharedScore: number; // cumulative community score (shared between players)
  tierId: number; //     current hoop tier (see shared/tiers.ts)
}

/**
 * Everything needed to reproduce a throw anywhere: release point + velocity
 * (+ where the shooter stood, which drives the points table) — clients
 * animate the arc themselves; nobody streams the ball.
 */
export interface ThrowLaunch {
  shotX: number; // where the shooter stood (floor meters)
  shotD: number;
  x: number; //    release point
  d: number;
  h: number;
  vx: number; //   launch velocity, m/s
  vh: number;
  slam: boolean; // thrown while teleport-levitating (500-pt slam attempt)
}

export interface ThrowOutcome {
  playerId: string;
  throwId: string;
  made: boolean;
  swish: boolean;
  slam: boolean;
  /** rims made — 2 on a tier-3 "double shot" through both rims */
  rims: number;
  distM: number;
  points: number;
  world: WorldState; // shared state after this outcome
}

/** A line of the persistent court wall, replayed to late joiners. */
export type HistoryEntry =
  | {
      kind: "outcome";
      name: string;
      made: boolean;
      swish: boolean;
      slam: boolean;
      distM: number;
      points: number;
    }
  | { kind: "chat"; name: string; text: string }
  | { kind: "presence"; name: string; joined: boolean }
  | { kind: "reset"; name: string };

// ── client → server ───────────────────────────────────────────────────

export type ClientMsg =
  | {
      t: "join";
      lobby: string;
      identity: Cosmetics & { id: string };
      /** ?reset link flag: wipe the world's shared score before joining */
      reset?: boolean;
    }
  | { t: "move-to"; x: number; d: number }
  | { t: "throw"; throwId: string; launch: ThrowLaunch }
  | { t: "chat"; text: string }
  /** pose telemetry, ~12 Hz while animating — cosmetic, relayed as-is */
  | { t: "pose"; s: AvatarState }
  /** admin CLI (scripts/admin.ts): kick a lobby before its files move */
  | { t: "admin"; token: string; cmd: "remove"; lobby: string };

// ── server → client ───────────────────────────────────────────────────

export type ServerMsg =
  | {
      t: "welcome";
      selfId: string;
      players: PlayerInfo[];
      world: WorldState;
      orb: OrbState | null;
      throwsRemaining: number;
      history: HistoryEntry[];
    }
  | { t: "join-rejected"; reason: "full" }
  | { t: "player-joined"; player: PlayerInfo }
  | { t: "player-left"; id: string; name: string }
  | { t: "move-to"; id: string; x: number; d: number }
  | { t: "pose"; id: string; s: AvatarState }
  | { t: "throw"; id: string; throwId: string; launch: ThrowLaunch }
  | { t: "outcome"; outcome: ThrowOutcome }
  | { t: "throw-rejected"; throwId: string; reason: "budget" | "invalid" }
  | { t: "chat"; id: string; name: string; text: string }
  | { t: "tier-unlock"; tierId: number; world: WorldState }
  | { t: "budget"; throwsRemaining: number }
  /** someone joined with a ?reset link — the shared score was wiped */
  | { t: "world-reset"; name: string; world: WorldState }
  /** the admin removed this lobby — show a notice, expect the close */
  | { t: "lobby-removed" }
  /** ack for an admin command (sent to the CLI socket only) */
  | { t: "admin-result"; ok: boolean; detail: string }
  // ── server-authoritative world objects (the orb) ──────────────────
  | { t: "orb-spawned"; orb: OrbState }
  /** byId present = consumed by that player's ball; absent = expired */
  | { t: "orb-removed"; seq: number; byId?: string }
  /**
   * A player's ball hit the orb — they zap up to it (h = orb height).
   * throwId identifies the consumed ball so every client can pop it.
   */
  | { t: "teleported"; id: string; throwId?: string; x: number; d: number; h: number }
  | {
      t: "snapshot";
      players: PlayerInfo[];
      world: WorldState;
      orb: OrbState | null;
    };
