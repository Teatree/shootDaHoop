import { BALANCE } from "../shared/config";
import { pointsForDistance } from "../shared/scoring";
import { tierForScore } from "../shared/tiers";
import { clampToCourt, FREE_THROW_X, RIM } from "../shared/court";
import type { PlayerInfo, ThrowLaunch, WorldState } from "../shared/messages";
import { BackendEmitter, type Backend, type BackendEvents } from "./types";

// Single-player: the whole "server" runs in-process and echoes
// synchronously, so the game plays EXACTLY as the prototype did. The
// client's live ball is the authority here (reportOutcome) — its
// frame-time-fed simulation is the feel we're preserving. In multiplayer
// the SocketBackend ignores reports and the server resolves instead.

export interface LocalIdentity {
  name: string;
  shirtColor: number;
}

export class LocalBackend implements Backend {
  private readonly emitter = new BackendEmitter();
  private readonly self: PlayerInfo;
  private world: WorldState = { sharedScore: 0, tierId: 1 };
  private pendingThrows = new Map<string, ThrowLaunch>();

  constructor(identity: LocalIdentity) {
    const spawn = clampToCourt(FREE_THROW_X, RIM.d);
    this.self = {
      id: "local",
      name: identity.name,
      shirtColor: identity.shirtColor,
      x: spawn.x,
      d: spawn.d,
    };
  }

  connect(): void {
    this.emitter.emit("welcome", {
      selfId: this.self.id,
      players: [this.self],
      world: { ...this.world },
      // local play is unlimited — the budget is a SERVER rule (Stage 2);
      // report the full daily allowance for display purposes
      throwsRemaining: BALANCE.budget.throwsPerDay,
    });
  }

  moveTo(x: number, d: number): void {
    const c = clampToCourt(x, d);
    this.self.x = c.x;
    this.self.d = c.d;
    this.emitter.emit("playerMoved", { id: this.self.id, x: c.x, d: c.d });
  }

  requestThrow(throwId: string, launch: ThrowLaunch): void {
    // no budget check locally — unlimited practice, by design
    this.pendingThrows.set(throwId, launch);
    this.emitter.emit("throwStarted", { id: this.self.id, throwId, launch });
  }

  reportOutcome(
    throwId: string,
    o: { made: boolean; swish: boolean; slam: boolean; distM: number },
  ): void {
    if (!this.pendingThrows.delete(throwId)) return; // unknown/duplicate
    const points = o.made
      ? o.slam
        ? BALANCE.score.slamPts
        : pointsForDistance(o.distM)
      : 0;
    const prevTier = tierForScore(this.world.sharedScore).id;
    this.world = {
      sharedScore: this.world.sharedScore + points,
      tierId: tierForScore(this.world.sharedScore + points).id,
    };
    this.emitter.emit("outcome", {
      playerId: this.self.id,
      throwId,
      made: o.made,
      swish: o.swish,
      slam: o.slam,
      distM: o.distM,
      points,
      world: { ...this.world },
    });
    if (this.world.tierId !== prevTier) {
      this.emitter.emit("tierUnlocked", {
        tierId: this.world.tierId,
        world: { ...this.world },
      });
    }
  }

  chat(text: string): void {
    this.emitter.emit("chatMessage", {
      id: this.self.id,
      name: this.self.name,
      text,
    });
  }

  on<K extends keyof BackendEvents>(event: K, fn: BackendEvents[K]): void {
    this.emitter.on(event, fn);
  }

  dispose(): void {
    this.emitter.clear();
  }
}
