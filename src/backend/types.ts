import type {
  AvatarState,
  HistoryEntry,
  JukeboxState,
  OrbState,
  PlayerInfo,
  ThrowLaunch,
  ThrowOutcome,
  WorldState,
} from "../shared/messages";

// The Backend seam: rendering/input (CourtScene) sit ABOVE this interface
// and never touch a transport directly. LocalBackend (backend/local.ts) is
// the single-player game; SocketBackend (Stage 2) is live multiplayer.
// Both speak the shared/messages.ts vocabulary.

export interface BackendEvents {
  /** you're in: who you are, who's here, where the world stands */
  welcome: (e: {
    selfId: string;
    players: PlayerInfo[];
    world: WorldState;
    orb: OrbState | null;
    throwsRemaining: number;
    history: HistoryEntry[];
  }) => void;
  joinRejected: (e: { reason: "full" }) => void;
  /** the connection dropped (socket backends only) */
  disconnected: (e: { reason?: string }) => void;
  /** the admin removed this lobby - a kick, not a network drop */
  lobbyRemoved: (e: Record<string, never>) => void;
  playerJoined: (e: { player: PlayerInfo }) => void;
  playerLeft: (e: { id: string; name: string }) => void;
  /** the player disconnected; their character STAYS and waits - gray the
   *  tag. A later playerJoined with the same id = they reclaimed it. */
  playerWentOffline: (e: { id: string; name: string }) => void;
  /** a movement intent - every client animates the walk locally */
  playerMoved: (e: { id: string; x: number; d: number }) => void;
  /**
   * pose telemetry (~12 Hz): full avatar state, interpolated on the
   * receiving side. When fresh it drives remote avatars entirely; the
   * move-to intent walk is the staleness fallback.
   */
  playerPosed: (e: { id: string; s: AvatarState }) => void;
  /** a throw is happening - clients animate the arc from the launch params */
  throwStarted: (e: { id: string; throwId: string; launch: ThrowLaunch }) => void;
  /** the authoritative result (server-decided in multiplayer) */
  outcome: (e: ThrowOutcome) => void;
  throwRejected: (e: { throwId: string; reason: "budget" | "invalid" }) => void;
  /** a player caught their own missed ball back - the held miss for this
   *  throwId is dropped and a catch line logs instead (throw refunded) */
  caught: (e: { id: string; name: string; throwId: string }) => void;
  chatMessage: (e: { id: string; name: string; text: string }) => void;
  /**
   * A player pressed the Upgrade button: score reset, tier advanced,
   * everyone teleported clear - the change list plays on every client.
   */
  upgraded: (e: {
    tierId: number;
    world: WorldState;
    byId: string;
    byName: string;
    placements: { id: string; x: number; d: number }[];
  }) => void;
  /** OUR Upgrade press was refused - threshold not met on the authority
   *  (a stale server build after a tiers.ts edit) or presser too far */
  upgradeRejected: (e: { reason: "threshold" | "proximity" }) => void;
  /** someone pressed the jukebox - the new song, or null = turned OFF */
  jukebox: (e: { state: JukeboxState | null; byName: string }) => void;
  budget: (e: { throwsRemaining: number }) => void;
  /** someone joined with a ?reset link - the shared score was wiped */
  worldReset: (e: { name: string; world: WorldState }) => void;
  // ── server-authoritative world objects (the orb) ──────────────────
  orbSpawned: (e: { orb: OrbState }) => void;
  /** byId present = consumed by that player's ball; absent = expired */
  orbRemoved: (e: { seq: number; byId?: string }) => void;
  /** the authority ruled a player's ball hit the orb - they zap up */
  teleported: (e: {
    id: string;
    throwId?: string; // the consumed ball, so every client can pop it
    x: number;
    d: number;
    h: number;
  }) => void;
  snapshot: (e: {
    players: PlayerInfo[];
    world: WorldState;
    orb: OrbState | null;
  }) => void;
}

export interface Backend {
  /** join the world; fires `welcome` (synchronously for LocalBackend) */
  connect(): void;

  // ── intents (client → authority) ──────────────────────────────────
  moveTo(x: number, d: number): void;
  /** cosmetic pose telemetry - LocalBackend no-ops (nobody's watching) */
  sendPose(s: AvatarState): void;
  requestThrow(throwId: string, launch: ThrowLaunch): void;
  /**
   * My missed ball landed at my feet - catch it (owner ask 2026-07-16).
   * The authority validates (own throw, ruled a miss, not born from a
   * catch), refunds the throw and broadcasts `caught`. The client plays
   * the catch optimistically; a refused catch just never refunds.
   */
  catchBall(throwId: string): void;
  /** press the Upgrade button - the authority validates and broadcasts */
  upgrade(): void;
  /** press the jukebox - the authority re-rolls the synced song */
  jukeboxPress(): void;
  /** the OFF toggle - the authority stops the song for everyone */
  jukeboxOffPress(): void;
  chat(text: string): void;

  /**
   * The client's live ball resolved (its feel-simulation finished).
   * LocalBackend treats this as authoritative - single player IS the
   * authority. SocketBackend ignores it; the server's resolution arrives
   * as an `outcome` event instead.
   */
  reportOutcome(
    throwId: string,
    o: {
      made: boolean;
      swish: boolean;
      slam: boolean;
      rims: number;
      distM: number;
    },
  ): void;

  /**
   * The client's live ball touched orb `seq` (its optimistic zap already
   * played). LocalBackend treats this as authoritative and echoes the
   * orbRemoved/teleported events; SocketBackend ignores it - the server
   * simulates the same arc and broadcasts its own ruling.
   */
  reportOrbHit(seq: number): void;

  on<K extends keyof BackendEvents>(event: K, fn: BackendEvents[K]): void;

  dispose(): void;
}

/** Minimal typed emitter shared by the backend implementations. */
export class BackendEmitter {
  private listeners = new Map<keyof BackendEvents, Set<(e: never) => void>>();

  on<K extends keyof BackendEvents>(event: K, fn: BackendEvents[K]): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (e: never) => void);
  }

  emit<K extends keyof BackendEvents>(
    event: K,
    payload: Parameters<BackendEvents[K]>[0],
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) (fn as (e: typeof payload) => void)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
