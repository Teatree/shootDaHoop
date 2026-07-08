import type {
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
    throwsRemaining: number;
  }) => void;
  playerJoined: (e: { player: PlayerInfo }) => void;
  playerLeft: (e: { id: string; name: string }) => void;
  /** a movement intent — every client animates the walk locally */
  playerMoved: (e: { id: string; x: number; d: number }) => void;
  /** a throw is happening — clients animate the arc from the launch params */
  throwStarted: (e: { id: string; throwId: string; launch: ThrowLaunch }) => void;
  /** the authoritative result (server-decided in multiplayer) */
  outcome: (e: ThrowOutcome) => void;
  throwRejected: (e: { throwId: string; reason: "budget" | "invalid" }) => void;
  chatMessage: (e: { id: string; name: string; text: string }) => void;
  tierUnlocked: (e: { tierId: number; world: WorldState }) => void;
  budget: (e: { throwsRemaining: number }) => void;
  snapshot: (e: { players: PlayerInfo[]; world: WorldState }) => void;
}

export interface Backend {
  /** join the world; fires `welcome` (synchronously for LocalBackend) */
  connect(): void;

  // ── intents (client → authority) ──────────────────────────────────
  moveTo(x: number, d: number): void;
  requestThrow(throwId: string, launch: ThrowLaunch): void;
  chat(text: string): void;

  /**
   * The client's live ball resolved (its feel-simulation finished).
   * LocalBackend treats this as authoritative — single player IS the
   * authority. SocketBackend ignores it; the server's resolution arrives
   * as an `outcome` event instead.
   */
  reportOutcome(
    throwId: string,
    o: { made: boolean; swish: boolean; slam: boolean; distM: number },
  ): void;

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
