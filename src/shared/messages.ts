// The typed client↔server vocabulary — ONE file, so a payload-shape
// mismatch is a compile error, not a runtime surprise. Dependency-free;
// imported by the client Backend implementations and the server.

import type { OrbState } from "./orb";

export type { OrbState };

// ── shared shapes ─────────────────────────────────────────────────────

export interface PlayerInfo {
  id: string; //         platform identity (Telegram/Discord user id) or local
  name: string;
  shirtColor: number; // 0xRRGGBB
  x: number; //          court meters (last known/spawn)
  d: number;
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
      identity: { id: string; name: string; shirtColor: number };
      /** ?reset link flag: wipe the world's shared score before joining */
      reset?: boolean;
    }
  | { t: "move-to"; x: number; d: number }
  | { t: "throw"; throwId: string; launch: ThrowLaunch }
  | { t: "chat"; text: string };

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
  | { t: "throw"; id: string; throwId: string; launch: ThrowLaunch }
  | { t: "outcome"; outcome: ThrowOutcome }
  | { t: "throw-rejected"; throwId: string; reason: "budget" | "invalid" }
  | { t: "chat"; id: string; name: string; text: string }
  | { t: "tier-unlock"; tierId: number; world: WorldState }
  | { t: "budget"; throwsRemaining: number }
  /** someone joined with a ?reset link — the shared score was wiped */
  | { t: "world-reset"; name: string; world: WorldState }
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
