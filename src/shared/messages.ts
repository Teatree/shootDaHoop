// The typed client↔server vocabulary - ONE file, so a payload-shape
// mismatch is a compile error, not a runtime surprise. Dependency-free;
// imported by the client Backend implementations and the server.

import type { OrbState } from "./orb";
import type { PoseState } from "./pose";
import type { HoopMotionState } from "./hoopMotion";

export type { OrbState };
export type { PoseState };
export type { HoopMotionState };

/**
 * Everything needed to draw a character at one instant. Streamed as
 * telemetry (~12 Hz, interpolated on arrival), sampled per-frame into
 * ghost recordings - ONE format for both, by design.
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
  shirtColor: number; // 0xRRGGBB - hard tint on the white t-shirt part
  skinTint: number; //   0xRRGGBB - multiply tint shared by head + hands
  lowerTint: number; //  0xRRGGBB - subtle tint on the trouser band
  headVariant: number; // 1-based index into the head_v* part textures
  x: number; //          court meters (last known/spawn)
  d: number;
  /** the player disconnected but their character waits around - clients
   *  gray the name tag (absent = online, keeps old payloads parsing) */
  offline?: boolean;
}

/** Per-lobby cosmetic identity, rolled client-side on first entry. */
export interface Cosmetics {
  name: string;
  shirtColor: number;
  skinTint: number;
  lowerTint: number;
  headVariant: number;
}

/** The jukebox loop everyone in the world hears (Hoop 3+). */
export interface JukeboxState {
  song: number; //        0-based index into the song slots
  startedAtMs: number; // epoch ms the loop began - clients seek to sync
}

export interface WorldState {
  sharedScore: number; // cumulative community score (shared between players)
  tierId: number; //     current hoop tier (see shared/tiers.ts)
  /** current jukebox loop; absent/null = silence (or no jukebox yet) */
  jukebox?: JukeboxState | null;
  /**
   * How many players this court was built for (2-5; absent = 3, the
   * balance baseline). Captured ONCE at world creation from the invite
   * link and never changed mid-life. Scales ONLY the tier unlock
   * thresholds (see tierRules.scaledThreshold) - more players means
   * better odds of a sharp shooter, so requirements grow superlinearly.
   */
  expectedPlayers?: number;
  /**
   * The moving hoop's schedule (Hoop 4+): rolled by the authority at
   * the upgrade, anchored to epoch time so everyone (and restarts)
   * replays the same timeline. Absent/null while the tier's hoop
   * stands still (see shared/hoopMotion.ts).
   */
  hoopMotion?: HoopMotionState | null;
  /**
   * Extra score required ON TOP of the next tier's threshold - the
   * ladder-extension migration (owner 2026-07-19): a world that was
   * already sitting at the old ladder top (Hoop 3) with banked score
   * gets base = that score at hydrate, so the new rung is EARNED from
   * where they are instead of unlocking instantly. Upgrades and resets
   * set it back to 0; absent counts as 0.
   */
  thresholdBase?: number;
}

/**
 * Everything needed to reproduce a throw anywhere: release point + velocity
 * (+ where the shooter stood, which drives the points table) - clients
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
  /** epoch ms of the release - against a MOVING hoop (tier 4) the
   *  thrower's flight and the server's resolution read the hoop's
   *  timeline from this instant, so they stay one trajectory. The
   *  server clamps it (shared/hoopMotion.clampLaunchStamp); absent on
   *  still-hoop tiers and old clients (falls back to arrival time). */
  atMs?: number;
}

export interface ThrowOutcome {
  playerId: string;
  throwId: string;
  made: boolean;
  swish: boolean;
  slam: boolean;
  /** rims made - 2 on a tier-3 "double shot" through both rims */
  rims: number;
  distM: number;
  points: number;
  world: WorldState; // shared state after this outcome
}

/** A line of the persistent court wall, replayed to late joiners.
 *  Every entry carries `atMs` (stamped by the server's record()) so the
 *  wall shows a simple HH:MM per line; absent on walls from before the
 *  stamp existed - those lines just show no time. */
export type HistoryEntry = HistoryEntryBody & { atMs?: number };

type HistoryEntryBody =
  | {
      kind: "outcome";
      name: string;
      made: boolean;
      swish: boolean;
      slam: boolean;
      /** rims made (2 = double shot) - absent on entries from before tier 3 */
      rims?: number;
      distM: number;
      points: number;
      /** the throw behind this line - late joiners fetch its stored
       *  ghost recording to replay it (absent on older entries) */
      throwId?: string;
      /** this miss was CAUGHT moments later - it never counts as a miss,
       *  so late joiners skip the line (the catch entry follows it) */
      caught?: true;
    }
  | { kind: "chat"; name: string; text: string }
  | { kind: "presence"; name: string; joined: boolean }
  | { kind: "reset"; name: string }
  | { kind: "upgrade"; name: string; tierId: number }
  /** the player caught their own missed ball back (throw refunded) */
  | { kind: "catch"; name: string };

// ── client → server ───────────────────────────────────────────────────

export type ClientMsg =
  | {
      t: "join";
      lobby: string;
      identity: Cosmetics & { id: string };
      /** ?reset link flag: wipe the world's shared score before joining */
      reset?: boolean;
      /** ?players=N from the invite link - only the join that CREATES
       *  the world reads it (2-5); ignored ever after */
      players?: number;
    }
  | { t: "move-to"; x: number; d: number }
  | { t: "throw"; throwId: string; launch: ThrowLaunch }
  /** my missed ball landed at my feet - I catch it (authority validates
   *  own throw, ruled a miss, not born from a catch, and refunds) */
  | { t: "catch"; throwId: string }
  /** press the Upgrade button - the server validates threshold + proximity */
  | { t: "upgrade" }
  /** press the jukebox - re-rolls the song everyone hears (tier 3+) */
  | { t: "jukebox" }
  /** the OFF toggle beside a PLAYING jukebox - stops it for everyone */
  | { t: "jukebox-off" }
  | { t: "chat"; text: string }
  /** pose telemetry, ~12 Hz while animating - cosmetic, relayed as-is */
  | { t: "pose"; s: AvatarState }
  /** upload the finished ghost recording of an OWN throw - the server
   *  stores it so any player can replay the wall line later. The
   *  payload is the client's ThrowRecording, opaque to the server. */
  | { t: "recording"; throwId: string; rec: unknown }
  /** fetch a stored recording (a wall line was clicked) */
  | { t: "get-recording"; throwId: string }
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
      /** seconds until the next ball regenerates; null at the cap.
       *  A DURATION on purpose - client clocks can't bend it. */
      nextBallInS: number | null;
      history: HistoryEntry[];
    }
  | { t: "join-rejected"; reason: "full" }
  | { t: "player-joined"; player: PlayerInfo }
  | { t: "player-left"; id: string; name: string }
  /** the player disconnected; their character STAYS, tag grayed -
   *  player-joined with the same id later = they reclaimed it */
  | { t: "player-offline"; id: string; name: string }
  | { t: "move-to"; id: string; x: number; d: number }
  | { t: "pose"; id: string; s: AvatarState }
  | { t: "throw"; id: string; throwId: string; launch: ThrowLaunch }
  | { t: "outcome"; outcome: ThrowOutcome }
  | { t: "throw-rejected"; throwId: string; reason: "budget" | "invalid" }
  /** a player caught their own missed ball - the earlier miss for this
   *  throwId is retracted on every screen and a catch line logs instead */
  | { t: "caught"; id: string; name: string; throwId: string }
  | { t: "chat"; id: string; name: string; text: string }
  /**
   * A player pressed the Upgrade button: the shared score reset, the
   * tier advanced, and everyone was teleported clear of the hoop. The
   * tier's ordered change list plays out on every client.
   */
  | {
      t: "upgraded";
      tierId: number;
      world: WorldState;
      byId: string;
      byName: string;
      placements: { id: string; x: number; d: number }[];
    }
  /**
   * The Upgrade press was refused (sent to the presser only). Client and
   * server share tiers.ts, so "threshold" here while the client showed
   * the button usually means the SERVER IS RUNNING A STALE BUILD - tsx
   * doesn't hot-reload; restart it after editing shared code.
   */
  | { t: "upgrade-rejected"; reason: "threshold" | "proximity" }
  /** someone pressed the jukebox - the new song (or null = turned OFF),
   *  synced to everyone */
  | { t: "jukebox"; state: JukeboxState | null; byName: string }
  | { t: "budget"; throwsRemaining: number; nextBallInS: number | null }
  /** someone joined with a ?reset link - the shared score was wiped */
  | { t: "world-reset"; name: string; world: WorldState }
  /** the admin removed this lobby - show a notice, expect the close */
  | { t: "lobby-removed" }
  /** a stored ghost recording (or null: none survives for that throw) */
  | { t: "recording"; throwId: string; rec: unknown | null }
  /** ack for an admin command (sent to the CLI socket only) */
  | { t: "admin-result"; ok: boolean; detail: string }
  // ── server-authoritative world objects (the orb) ──────────────────
  | { t: "orb-spawned"; orb: OrbState }
  /** byId present = consumed by that player's ball; absent = expired */
  | { t: "orb-removed"; seq: number; byId?: string }
  /**
   * A player's ball hit the orb - they zap up to it (h = orb height).
   * throwId identifies the consumed ball so every client can pop it.
   */
  | { t: "teleported"; id: string; throwId?: string; x: number; d: number; h: number }
  | {
      t: "snapshot";
      players: PlayerInfo[];
      world: WorldState;
      orb: OrbState | null;
    };
