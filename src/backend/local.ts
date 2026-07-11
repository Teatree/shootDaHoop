import { BALANCE } from "../shared/config";
import { pointsForDistance } from "../shared/scoring";
import { tierForScore } from "../shared/tiers";
import { clampToCourt, rollSpawn } from "../shared/court";
import { rollOrbSpawn, type OrbState } from "../shared/orb";
import type {
  Cosmetics,
  PlayerInfo,
  ThrowLaunch,
  WorldState,
} from "../shared/messages";
import { BackendEmitter, type Backend, type BackendEvents } from "./types";

// Single-player: the whole "server" runs in-process and echoes
// synchronously, so the game plays EXACTLY as the prototype did. The
// client's live ball is the authority here (reportOutcome, reportOrbHit)
// — its frame-time-fed simulation is the feel we're preserving. In
// multiplayer the SocketBackend ignores reports and the server resolves
// instead. The teleport orb lifecycle mirrors server/orb.ts: spawn after
// cadenceS, expire after lifeS, respawn cadenceS after it's gone.

export type LocalIdentity = Cosmetics;

export class LocalBackend implements Backend {
  private readonly emitter = new BackendEmitter();
  private readonly self: PlayerInfo;
  private world: WorldState = { sharedScore: 0, tierId: 1 };
  private pendingThrows = new Map<string, ThrowLaunch>();
  private orb: OrbState | null = null;
  private orbSeq = 0;
  private orbTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(identity: LocalIdentity) {
    const spawn = rollSpawn(); // random spot beside the keep-out zone
    this.self = { id: "local", ...identity, x: spawn.x, d: spawn.d };
  }

  connect(): void {
    this.emitter.emit("welcome", {
      selfId: this.self.id,
      players: [this.self],
      world: { ...this.world },
      orb: null,
      // local play is unlimited — the budget is a SERVER rule (Stage 2);
      // report the full daily allowance for display purposes
      throwsRemaining: BALANCE.budget.throwsPerDay,
      history: [],
    });
    this.scheduleOrbSpawn();
  }

  // ── orb lifecycle (this IS the authority offline) ──────────────────

  private scheduleOrbSpawn() {
    this.orbTimer = setTimeout(() => {
      this.orb = rollOrbSpawn(++this.orbSeq);
      this.emitter.emit("orbSpawned", { orb: this.orb });
      this.scheduleOrbExpiry();
    }, BALANCE.orb.cadenceS * 1000);
  }

  private scheduleOrbExpiry() {
    this.orbTimer = setTimeout(() => {
      const o = this.orb;
      if (!o) return;
      this.orb = null;
      this.emitter.emit("orbRemoved", { seq: o.seq });
      this.scheduleOrbSpawn();
    }, BALANCE.orb.lifeS * 1000);
  }

  /** The live ball touched the orb — authoritative in single player. */
  reportOrbHit(seq: number): void {
    const o = this.orb;
    if (!o || o.seq !== seq) return; // expired first — nothing to take
    this.orb = null;
    if (this.orbTimer) clearTimeout(this.orbTimer);
    this.emitter.emit("orbRemoved", { seq: o.seq, byId: this.self.id });
    this.emitter.emit("teleported", { id: this.self.id, x: o.x, d: o.d, h: o.h });
    this.scheduleOrbSpawn();
  }

  moveTo(x: number, d: number): void {
    const c = clampToCourt(x, d);
    this.self.x = c.x;
    this.self.d = c.d;
    this.emitter.emit("playerMoved", { id: this.self.id, x: c.x, d: c.d });
  }

  sendPose(): void {
    // single player — nobody to telegraph to
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
    if (this.orbTimer) clearTimeout(this.orbTimer);
    this.emitter.clear();
  }
}
