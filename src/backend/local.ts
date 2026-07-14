import { BALANCE } from "../shared/config";
import {
  consumeThrow,
  refundThrow,
  remainingThrows,
  type BudgetFields,
} from "../shared/budget";
import { pointsForDistance } from "../shared/scoring";
import { clampToCourt, rollSpawn, rollUpgradeClearSpot } from "../shared/court";
import {
  canUpgrade,
  interactivesForTier,
  nextTier,
  orbTimingForTier,
} from "../shared/tierRules";
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

/** Offline daily budget — persisted per browser, same UTC reset as the server. */
const BUDGET_KEY = "shootDaHoop.budget";

function loadBudget(): BudgetFields {
  try {
    const b = JSON.parse(localStorage.getItem(BUDGET_KEY) ?? "") as BudgetFields;
    if (
      typeof b.throwsUsedToday === "number" &&
      typeof b.lastThrowDayUTC === "string"
    )
      return b;
  } catch {
    /* absent/corrupt store → fresh allowance */
  }
  return { throwsUsedToday: 0, lastThrowDayUTC: "" };
}

export class LocalBackend implements Backend {
  private readonly emitter = new BackendEmitter();
  private readonly self: PlayerInfo;
  private world: WorldState = { sharedScore: 0, tierId: 1 };
  private pendingThrows = new Map<string, ThrowLaunch>();
  private orb: OrbState | null = null;
  private orbSeq = 0;
  private orbTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly budget: BudgetFields = loadBudget();

  constructor(identity: LocalIdentity) {
    const spawn = rollSpawn(); // random spot beside the keep-out zone
    this.self = { id: "local", ...identity, x: spawn.x, d: spawn.d };
  }

  private saveBudget() {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(this.budget));
  }

  connect(): void {
    this.emitter.emit("welcome", {
      selfId: this.self.id,
      players: [this.self],
      world: { ...this.world },
      orb: null,
      throwsRemaining: remainingThrows(this.budget, new Date()),
      history: [],
    });
    this.scheduleOrbSpawn();
  }

  // ── orb lifecycle (this IS the authority offline) ──────────────────

  private scheduleOrbSpawn() {
    // tier-timed, like server/orb.ts: fixed cadence at tiers 1–2, the
    // random 10–20 s / 5 s life Ambient/Spawn Change from Hoop 3 on
    const t = orbTimingForTier(this.world.tierId);
    const cadenceS =
      t.minCadenceS + Math.random() * (t.maxCadenceS - t.minCadenceS);
    this.orbTimer = setTimeout(() => {
      this.orb = rollOrbSpawn(++this.orbSeq);
      this.emitter.emit("orbSpawned", { orb: this.orb });
      this.scheduleOrbExpiry();
    }, cadenceS * 1000);
  }

  private scheduleOrbExpiry() {
    this.orbTimer = setTimeout(() => {
      const o = this.orb;
      if (!o) return;
      this.orb = null;
      this.emitter.emit("orbRemoved", { seq: o.seq });
      this.scheduleOrbSpawn();
    }, orbTimingForTier(this.world.tierId).lifeS * 1000);
  }

  /** The live ball touched the orb — authoritative in single player. */
  reportOrbHit(seq: number): void {
    const o = this.orb;
    if (!o || o.seq !== seq) return; // expired first — nothing to take
    this.orb = null;
    if (this.orbTimer) clearTimeout(this.orbTimer);
    // hitting the orb keeps the ball — same free-slam rule as the server
    refundThrow(this.budget, new Date());
    this.saveBudget();
    this.emitter.emit("budget", {
      throwsRemaining: remainingThrows(this.budget, new Date()),
    });
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
    // the same daily budget as the server, against the localStorage counter
    if (!consumeThrow(this.budget, new Date())) {
      this.emitter.emit("throwRejected", { throwId, reason: "budget" });
      return;
    }
    this.saveBudget();
    this.emitter.emit("budget", {
      throwsRemaining: remainingThrows(this.budget, new Date()),
    });
    this.pendingThrows.set(throwId, launch);
    this.emitter.emit("throwStarted", { id: this.self.id, throwId, launch });
  }

  reportOutcome(
    throwId: string,
    o: {
      made: boolean;
      swish: boolean;
      slam: boolean;
      rims: number;
      distM: number;
    },
  ): void {
    if (!this.pendingThrows.delete(throwId)) return; // unknown/duplicate
    // PLACEHOLDER (tune): double-shot points mirror shared/simulate.ts —
    // pointsForDistance × rims made
    const points = o.made
      ? o.slam
        ? BALANCE.score.slamPts
        : pointsForDistance(o.distM) * Math.max(1, o.rims)
      : 0;
    // score accumulates; the tier only advances via a triggered upgrade
    // (mirrors server/room.ts)
    this.world = {
      ...this.world,
      sharedScore: this.world.sharedScore + points,
    };
    this.emitter.emit("outcome", {
      playerId: this.self.id,
      throwId,
      made: o.made,
      swish: o.swish,
      slam: o.slam,
      rims: o.rims,
      distM: o.distM,
      points,
      world: { ...this.world },
    });
  }

  /** The Upgrade press — mirrors server/room.ts (threshold, reset, clear). */
  upgrade(): void {
    if (!canUpgrade(this.world)) return;
    const next = nextTier(this.world.tierId);
    if (!next) return;
    this.world = { sharedScore: 0, tierId: next.id };
    const spot = rollUpgradeClearSpot();
    this.self.x = spot.x;
    this.self.d = spot.d;
    this.emitter.emit("upgraded", {
      tierId: next.id,
      world: { ...this.world },
      byId: this.self.id,
      byName: this.self.name,
      placements: [{ id: this.self.id, x: spot.x, d: spot.d }],
    });
  }

  /** The jukebox press — mirrors server/room.ts (re-roll ≠ current). */
  jukeboxPress(): void {
    const box = interactivesForTier(this.world.tierId).find(
      (el) => el.element === "jukebox",
    );
    if (!box) return;
    const cur = this.world.jukebox?.song;
    let song = Math.floor(Math.random() * BALANCE.jukebox.songs);
    if (BALANCE.jukebox.songs > 1 && song === cur)
      song = (song + 1) % BALANCE.jukebox.songs;
    const state = { song, startedAtMs: Date.now() };
    this.world = { ...this.world, jukebox: state };
    this.emitter.emit("jukebox", { state, byName: this.self.name });
  }

  /** The OFF toggle — mirrors server/room.ts (only while playing). */
  jukeboxOffPress(): void {
    if (!this.world.jukebox) return;
    this.world = { ...this.world, jukebox: null };
    this.emitter.emit("jukebox", { state: null, byName: this.self.name });
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
