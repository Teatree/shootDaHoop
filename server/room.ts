import type { WebSocket } from "ws";
import { BALANCE } from "../src/shared/config";
import {
  RIM,
  clampToCourt,
  rollSpawn,
  rollUpgradeClearSpot,
} from "../src/shared/court";
import { resolveThrow } from "../src/shared/simulate";
import {
  canUpgrade,
  clampToWalkable,
  effectivePowerForTier,
  interactivesForTier,
  nextTier,
  orbTimingForTier,
} from "../src/shared/tierRules";
import type {
  AvatarState,
  ClientMsg,
  Cosmetics,
  HistoryEntry,
  PlayerInfo,
  ServerMsg,
  ThrowLaunch,
  WorldState,
} from "../src/shared/messages";
import type { PlayerProfile, Storage } from "./storage";
import {
  consumeThrow,
  refundThrow,
  remainingThrows,
  type BudgetFields,
} from "../src/shared/budget";
import { OrbAuthority } from "./orb";

// One live world. Holds who's here (presence) and the shared world state.
// A DISCONNECT does not despawn the character: the occupant goes OFFLINE
// (ws = null, tag grayed on every client) and the character waits around -
// after a short delay it walks to a waiting spot (the cheer deck if it
// exists, else the far sideline) and stays until its player rejoins.
// Presence is still ephemeral at the ROOM level: when the last CONNECTED
// player leaves, the room tears down and offline characters evaporate
// with it (the world bundle persists; avatars don't). World state and
// profiles persist via storage.
//
// "The loop must never stop": every inbound message is handled inside a
// try/catch upstream (index.ts); a bad event degrades to a skip.

interface Occupant {
  info: PlayerInfo;
  /** null = the player disconnected; the character stays, offline */
  ws: WebSocket | null;
  profile: PlayerProfile;
  /** epoch ms until which a slam throw is legitimate (set on teleport) */
  levitatingUntil: number;
  /** the one-shot walk-to-the-waiting-spot after going offline */
  offlineWalkTimer: NodeJS.Timeout | null;
  /** catches banked: the NEXT throw is born from a caught ball and can
   *  never be caught again - the once-per-ball rule */
  catchCredits: number;
}

export class Room {
  private occupants = new Map<string, Occupant>();
  private world: WorldState = { sharedScore: 0, tierId: 1 };
  private history: HistoryEntry[] = [];
  /** resolved misses still inside the catch window, by throwId - the
   *  entry ref lets a catch retro-mark the wall line as caught */
  private recentMisses = new Map<
    string,
    {
      playerId: string;
      entry: HistoryEntry & { kind: "outcome" };
      catchable: boolean;
      atMs: number;
    }
  >();
  /** catches that RACED the scheduled outcome: the miss resolves at
   *  floor contact - the very instant the thrower's client detects the
   *  landing - so the catch message can beat the outcome timer by a
   *  breath. Parked here; applyOutcome retries them as the miss lands. */
  private earlyCatches = new Map<string, { playerId: string; atMs: number }>();
  /** outcomes scheduled to fire when the ball "lands" (resolvedAtS) */
  private pending = new Set<{ timer: NodeJS.Timeout; fire: () => void }>();
  /** full-ish snapshots: late joiners and dropped packets self-heal */
  private snapshotTimer: NodeJS.Timeout | null = null;
  /** the teleport orb - a server-authoritative world object (see orb.ts) */
  private readonly orb: OrbAuthority;
  /** resolves once the world bundle is hydrated - join() waits on this */
  readonly ready: Promise<void>;

  constructor(
    readonly lobby: string,
    private readonly storage: Storage,
    private readonly onEmpty: () => void,
  ) {
    this.ready = this.hydrate();
    this.orb = new OrbAuthority(
      {
        onSpawn: (orb) => this.broadcast({ t: "orb-spawned", orb }),
        onExpire: (seq) => this.broadcast({ t: "orb-removed", seq }),
      },
      // the tier's Ambient/Spawn Change: the clock re-reads this every
      // cycle, so an upgrade changes the cadence without a restart
      () => orbTimingForTier(this.world.tierId),
    );
    this.snapshotTimer = setInterval(() => {
      if (this.connectedCount() === 0) return;
      this.broadcast({
        t: "snapshot",
        players: [...this.occupants.values()].map((o) => ({ ...o.info })),
        world: { ...this.world },
        orb: this.orb.current,
      });
    }, BALANCE.lobby.snapshotIntervalS * 1000);
  }

  private async hydrate() {
    const bundle = await this.storage.loadWorld(this.lobby);
    if (bundle) {
      this.world = bundle.world;
      this.history = bundle.history ?? [];
    }
  }

  /** Connected players - offline characters don't count. */
  get size(): number {
    return this.connectedCount();
  }

  private connectedCount(): number {
    let n = 0;
    for (const o of this.occupants.values()) if (o.ws) n++;
    return n;
  }

  /** Returns true if the join was accepted (welcome sent). */
  async join(
    ws: WebSocket,
    identity: Cosmetics & { id: string },
    reset = false,
  ): Promise<boolean> {
    await this.ready;
    const existing = this.occupants.get(identity.id);
    // capacity counts CONNECTED players - a waiting offline character
    // must never lock its own player (or friends) out
    if (!existing && this.connectedCount() >= BALANCE.lobby.maxPlayers) {
      send(ws, { t: "join-rejected", reason: "full" });
      return false;
    }

    if (reset) {
      // the ?reset link: wipe the world's shared score (the communal
      // progression), keep the wall + everyone's daily budgets
      this.world = { sharedScore: 0, tierId: 1 };
      this.record({ kind: "reset", name: identity.name }); // also persists
      this.broadcast({
        t: "world-reset",
        name: identity.name,
        world: { ...this.world },
      }); // the joiner learns via its own welcome below
    }

    // profile is persistent and travels across worlds (budgets are kept
    // per lobby inside it - see budgetFor)
    const profile: PlayerProfile = (await this.storage.loadProfile(
      identity.id,
    )) ?? {
      id: identity.id,
      name: identity.name,
      shirtColor: identity.shirtColor,
    };
    profile.name = identity.name;
    profile.shirtColor = safeTint(identity.shirtColor);
    profile.skinTint = safeTint(identity.skinTint);
    profile.lowerTint = safeTint(identity.lowerTint);
    profile.headVariant = clampHead(identity.headVariant);
    void this.storage.saveProfile(profile).catch(logSaveError);

    if (existing) {
      // reconnect OR reclaim: replace the socket (a zombie, or null for
      // an offline character), keep the avatar exactly where it stands
      const wasOffline = existing.ws === null;
      if (existing.offlineWalkTimer) {
        clearTimeout(existing.offlineWalkTimer);
        existing.offlineWalkTimer = null;
      }
      try {
        existing.ws?.close();
      } catch {
        /* already dead */
      }
      existing.ws = ws;
      existing.info.name = identity.name;
      existing.profile = profile;
      if (wasOffline) {
        // the character comes back to life: un-gray the tag everywhere
        delete existing.info.offline;
        this.broadcast({ t: "player-joined", player: { ...existing.info } }, ws);
        this.record({ kind: "presence", name: identity.name, joined: true });
      }
    } else {
      const spawn = rollSpawn(); // random spot beside the keep-out zone
      const info: PlayerInfo = {
        id: identity.id,
        name: identity.name,
        shirtColor: safeTint(identity.shirtColor),
        skinTint: safeTint(identity.skinTint),
        lowerTint: safeTint(identity.lowerTint),
        headVariant: clampHead(identity.headVariant),
        x: spawn.x,
        d: spawn.d,
      };
      this.occupants.set(identity.id, {
        info,
        ws,
        profile,
        levitatingUntil: 0,
        offlineWalkTimer: null,
        catchCredits: 0,
      });
      this.broadcast({ t: "player-joined", player: info }, ws);
      this.record({ kind: "presence", name: identity.name, joined: true });
    }

    send(ws, {
      t: "welcome",
      selfId: identity.id,
      players: [...this.occupants.values()].map((o) => o.info),
      world: { ...this.world },
      orb: this.orb.current,
      throwsRemaining: remainingThrows(this.budgetFor(profile), new Date()),
      history: this.history.slice(0, -1), // minus our own join, logged live
    });
    return true;
  }

  leave(playerId: string, ws: WebSocket) {
    const occ = this.occupants.get(playerId);
    if (!occ || occ.ws !== ws) return; // stale socket from a reconnect
    // the character does NOT despawn: it goes offline (grayed tag) and
    // waits around - its player reclaims it on rejoin
    occ.ws = null;
    occ.info.offline = true;
    this.broadcast({ t: "player-offline", id: playerId, name: occ.info.name });
    this.record({ kind: "presence", name: occ.info.name, joined: false });
    this.scheduleOfflineWalk(playerId, occ);
    if (this.connectedCount() === 0) {
      // last CONNECTED player gone: flush in-flight outcomes so the
      // world state stays consistent, then tear down - the offline
      // characters evaporate with the room (world persists, they don't)
      for (const p of this.pending) {
        clearTimeout(p.timer);
        p.fire();
      }
      this.pending.clear();
      if (this.snapshotTimer) clearInterval(this.snapshotTimer);
      for (const o of this.occupants.values())
        if (o.offlineWalkTimer) clearTimeout(o.offlineWalkTimer);
      this.orb.stop();
      this.onEmpty();
    }
  }

  /**
   * PLACEHOLDER (behaviour, 2026-07-14): after offlineWalkDelayS the
   * abandoned character walks to a waiting spot - the cheer deck when the
   * tier has one, else the upper side of the field - via a normal move
   * intent, so every client animates the walk. It stays there until its
   * player rejoins.
   */
  private scheduleOfflineWalk(playerId: string, occ: Occupant) {
    if (occ.offlineWalkTimer) clearTimeout(occ.offlineWalkTimer);
    occ.offlineWalkTimer = setTimeout(() => {
      occ.offlineWalkTimer = null;
      if (occ.ws !== null) return; // reclaimed in the meantime
      const spot = this.waitingSpot();
      occ.info.x = spot.x;
      occ.info.d = spot.d;
      this.broadcast({ t: "move-to", id: playerId, x: spot.x, d: spot.d });
    }, BALANCE.presence.offlineWalkDelayS * 1000);
  }

  /** Where abandoned characters wait: a spot on the cheer deck (tier 2+),
   *  else along the far (upper) sideline, out of the shooting lane. */
  private waitingSpot(): { x: number; d: number } {
    const deck = interactivesForTier(this.world.tierId).find(
      (el) => el.element === "cheer-area" && el.occupiesSpot,
    );
    if (deck) {
      const span = deck.widthM * 0.6;
      return {
        x: deck.placement.xM - span / 2 + Math.random() * span,
        d: deck.placement.dM,
      };
    }
    // PLACEHOLDER (tune): the upper side of the field, spread out a bit
    return { x: 4 + Math.random() * 6, d: 0.4 };
  }

  /**
   * Admin removal: notify + kick everyone WITHOUT persisting anything -
   * the CLI moves the lobby's files right after this, so a stray write
   * from a leave handler or pending outcome would resurrect them.
   * Ordering is load-bearing: occupants cleared first so the socket
   * close handlers' leave() calls no-op; pending timers discarded
   * (never fired - firing would record() and re-save the world).
   */
  destroy(): void {
    const socks = [...this.occupants.values()].flatMap((o) =>
      o.ws ? [o.ws] : [],
    );
    for (const o of this.occupants.values())
      if (o.offlineWalkTimer) clearTimeout(o.offlineWalkTimer);
    this.occupants.clear();
    for (const p of this.pending) clearTimeout(p.timer);
    this.pending.clear();
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.orb.stop();
    const data = JSON.stringify({ t: "lobby-removed" } satisfies ServerMsg);
    for (const ws of socks) {
      if (ws.readyState === ws.OPEN) ws.send(data);
      try {
        ws.close();
      } catch {
        /* already dead */
      }
    }
  }

  /**
   * The player's throw budget IN THIS LOBBY - budgets are per lobby, so
   * a fresh court hands out a fresh set of balls (2026-07-13 fix: they
   * used to be one per-identity pool across every world).
   */
  private budgetFor(profile: PlayerProfile): BudgetFields {
    profile.budgets ??= {};
    return (profile.budgets[this.lobby] ??= {
      throwsUsedToday: 0,
      lastThrowDayUTC: "",
    });
  }

  /** Append to the wall history and persist the bundle - save on event. */
  private record(entry: HistoryEntry) {
    // the permanent archive gets EVERY entry, forever, per lobby -
    // the in-memory wall below stays capped for welcome replay
    void this.storage
      .appendLog(this.lobby, { at: Date.now(), ...entry })
      .catch(logSaveError);
    this.history.push(entry);
    if (this.history.length > BALANCE.lobby.historyKept)
      this.history = this.history.slice(-BALANCE.lobby.historyKept);
    this.persistWorld();
  }

  private persistWorld() {
    void this.storage
      .saveWorld({
        lobby: this.lobby,
        world: { ...this.world },
        history: this.history,
      })
      .catch(logSaveError);
  }

  handle(playerId: string, msg: ClientMsg) {
    const occ = this.occupants.get(playerId);
    // messages ride a live socket - an offline occupant can't send, and
    // capturing the non-null socket keeps the cases below honest
    const sock = occ?.ws;
    if (!occ || !sock) return;

    switch (msg.t) {
      case "move-to": {
        const c = clampToCourt(msg.x, msg.d);
        occ.info.x = c.x;
        occ.info.d = c.d;
        // intent broadcast - the sender already animates locally
        this.broadcast({ t: "move-to", id: playerId, x: c.x, d: c.d }, sock);
        break;
      }
      case "pose": {
        // cosmetic telemetry - sanitize the numbers, relay to everyone
        // else, and keep the presence info in step for snapshots
        const s = sanePose(msg.s, this.world.tierId, canUpgrade(this.world));
        if (!s) break;
        occ.info.x = s.x;
        occ.info.d = s.d;
        this.broadcast({ t: "pose", id: playerId, s }, sock);
        break;
      }
      case "throw": {
        if (!validLaunch(msg.launch, this.world.tierId)) {
          send(sock, {
            t: "throw-rejected",
            throwId: msg.throwId,
            reason: "invalid",
          });
          break;
        }
        // the budget is the server's, not the client's
        if (!consumeThrow(this.budgetFor(occ.profile), new Date())) {
          send(sock, {
            t: "throw-rejected",
            throwId: msg.throwId,
            reason: "budget",
          });
          break;
        }
        void this.storage.saveProfile(occ.profile).catch(logSaveError);
        send(sock, {
          t: "budget",
          throwsRemaining: remainingThrows(this.budgetFor(occ.profile), new Date()),
        });
        // never trust the client: a slam only counts if WE teleported
        // this player moments ago (the orb is server-side now)
        const slam = msg.launch.slam && Date.now() < occ.levitatingUntil;
        const launch: ThrowLaunch = { ...msg.launch, slam };
        // a throw made with a caught ball can't be caught again
        const bornFromCatch = occ.catchCredits > 0;
        if (bornFromCatch) occ.catchCredits--;
        // the thrower already animates locally - relay to everyone else
        this.broadcast(
          { t: "throw", id: playerId, throwId: msg.throwId, launch },
          sock,
        );
        // authoritative resolution NOW; the outcome fires when the ball
        // "lands" so score juice lines up with the visual flight
        const orb = this.orb.current;
        const res = resolveThrow(launch, orb, this.world.tierId);
        const playerName = occ.info.name; // captured - they may leave mid-flight
        if (res.orbHitAtS !== undefined && orb) {
          // ruled to hit the orb - confirm when the ball visually gets
          // there; if the orb is gone by then (expired / another ball
          // took it), the throw plays out as a plain arc instead
          const orbSeq = orb.seq;
          const plain = resolveThrow(launch, null, this.world.tierId);
          const hitAtS = res.orbHitAtS;
          this.schedule(
            () =>
              this.resolveOrbHit(playerId, playerName, msg.throwId, orbSeq, {
                plain,
                hitAtS,
                slam,
                bornFromCatch,
              }),
            hitAtS * 1000,
          );
        } else {
          this.schedule(
            () =>
              this.applyOutcome(
                playerId,
                playerName,
                msg.throwId,
                slam,
                res,
                bornFromCatch,
              ),
            Math.max(200, res.resolvedAtS * 1000),
          );
        }
        break;
      }
      case "catch": {
        // catch the ball (owner ask 2026-07-16): the client saw its own
        // missed ball land at the player's feet. The landing spot is the
        // thrower's client's truth (physics is non-deterministic across
        // machines by design) - the server rules the rest: THEIR throw,
        // ruled a MISS, inside the window, and not born from a catch.
        // A refused check is a silent skip: the client played the catch
        // optimistically, but no refund ever happens without this.
        if (this.tryCatch(playerId, msg.throwId) === "unknown") {
          // likely raced the outcome timer - park it for applyOutcome
          const cutoff = Date.now() - BALANCE.catchBall.windowS * 1000;
          for (const [id, c] of this.earlyCatches)
            if (c.atMs < cutoff) this.earlyCatches.delete(id);
          this.earlyCatches.set(msg.throwId, { playerId, atMs: Date.now() });
        }
        break;
      }
      case "upgrade": {
        // the communal upgrade press: ANY player may trigger it, but the
        // server owns the rules - threshold met, presser TOUCHING the
        // hoop (the button sits at its base; the errand walks the
        // presser through the keep-out zone, which the pose clamp opens
        // while an upgrade is available)
        // a refusal is TOLD to the presser - a silent break here once
        // cost a debugging session (client showed the button, a stale
        // server build still had the old threshold and ate the press)
        const next = nextTier(this.world.tierId);
        if (!canUpgrade(this.world) || !next) {
          send(sock, { t: "upgrade-rejected", reason: "threshold" });
          break;
        }
        if (
          Math.hypot(occ.info.x - RIM.x, occ.info.d - RIM.d) >
          BALANCE.upgrade.proximityM
        ) {
          send(sock, { t: "upgrade-rejected", reason: "proximity" });
          break;
        }
        // the next tier counts fresh from zero
        this.world = { sharedScore: 0, tierId: next.id };
        // teleport every active player clear of the hoop
        const placements = [...this.occupants.entries()].map(([id, o]) => {
          const spot = rollUpgradeClearSpot();
          o.info.x = spot.x;
          o.info.d = spot.d;
          return { id, x: spot.x, d: spot.d };
        });
        this.record({ kind: "upgrade", name: occ.info.name, tierId: next.id });
        this.broadcast({
          t: "upgraded",
          tierId: next.id,
          world: { ...this.world },
          byId: playerId,
          byName: occ.info.name,
          placements,
        });
        break;
      }
      case "jukebox": {
        // the box only exists from tier 3 on; the presser must be at it
        const box = interactivesForTier(this.world.tierId).find(
          (el) => el.element === "jukebox",
        );
        if (!box) break;
        if (
          Math.hypot(
            occ.info.x - box.placement.xM,
            occ.info.d - box.placement.dM,
          ) > BALANCE.jukebox.pressProximityM
        )
          break;
        // PLACEHOLDER (behaviour): a press RE-ROLLS a random song and
        // always lands on a different one than is playing
        const cur = this.world.jukebox?.song;
        let song = Math.floor(Math.random() * BALANCE.jukebox.songs);
        if (BALANCE.jukebox.songs > 1 && song === cur)
          song = (song + 1) % BALANCE.jukebox.songs;
        const state = { song, startedAtMs: Date.now() };
        this.world = { ...this.world, jukebox: state };
        this.persistWorld();
        // heard by EVERYONE in the world - not local
        this.broadcast({ t: "jukebox", state, byName: occ.info.name });
        break;
      }
      case "jukebox-off": {
        // the OFF toggle: same box, same proximity - and only meaningful
        // while something is (or recently was) playing. Clients gate the
        // button on live playback; the server just clears the state.
        if (!this.world.jukebox) break;
        const box = interactivesForTier(this.world.tierId).find(
          (el) => el.element === "jukebox",
        );
        if (!box) break;
        if (
          Math.hypot(
            occ.info.x - box.placement.xM,
            occ.info.d - box.placement.dM,
          ) > BALANCE.jukebox.pressProximityM
        )
          break;
        this.world = { ...this.world, jukebox: null };
        this.persistWorld();
        this.broadcast({ t: "jukebox", state: null, byName: occ.info.name });
        break;
      }
      case "chat": {
        const text = String(msg.text).slice(0, 1000).trim();
        if (!text) break;
        // to EVERYONE including the sender - one render path on the client
        this.broadcast({
          t: "chat",
          id: playerId,
          name: occ.info.name,
          text,
        });
        this.record({ kind: "chat", name: occ.info.name, text });
        break;
      }
      case "join":
        break; // already joined; ignore
    }
  }

  /** Track a delayed resolution so an emptying room can flush it. */
  private schedule(fire: () => void, delayMs: number) {
    const entry = {
      timer: setTimeout(() => {
        this.pending.delete(entry);
        fire();
      }, delayMs),
      fire,
    };
    this.pending.add(entry);
  }

  /**
   * A throw ruled to hit the orb just reached it. If the orb survived
   * until now, consume it and teleport the thrower (broadcast to all -
   * clients that predicted it locally dedupe by seq). Otherwise fall
   * back to the plain-arc outcome, waiting out the rest of the flight.
   */
  private resolveOrbHit(
    playerId: string,
    playerName: string,
    throwId: string,
    orbSeq: number,
    opts: {
      plain: ReturnType<typeof resolveThrow>;
      hitAtS: number;
      slam: boolean;
      bornFromCatch: boolean;
    },
  ) {
    const taken = this.orb.consume(orbSeq);
    if (taken) {
      const occ = this.occupants.get(playerId);
      if (occ) {
        occ.levitatingUntil =
          Date.now() + (BALANCE.orb.levitateS + 1.5) * 1000;
        occ.info.x = taken.x; // snapshots self-heal to the landing spot
        // hitting the orb keeps the ball - the slam is a FREE throw
        refundThrow(this.budgetFor(occ.profile), new Date());
        void this.storage.saveProfile(occ.profile).catch(logSaveError);
        if (occ.ws)
          send(occ.ws, {
            t: "budget",
            throwsRemaining: remainingThrows(this.budgetFor(occ.profile), new Date()),
          });
      }
      this.broadcast({ t: "orb-removed", seq: orbSeq, byId: playerId });
      this.broadcast({
        t: "teleported",
        id: playerId,
        throwId,
        x: taken.x,
        d: taken.d,
        h: taken.h,
      });
      return;
    }
    this.schedule(
      () =>
        this.applyOutcome(
          playerId,
          playerName,
          throwId,
          opts.slam,
          opts.plain,
          opts.bornFromCatch,
        ),
      Math.max(0, (opts.plain.resolvedAtS - opts.hitAtS) * 1000),
    );
  }

  private applyOutcome(
    playerId: string,
    playerName: string,
    throwId: string,
    slam: boolean,
    res: ReturnType<typeof resolveThrow>,
    bornFromCatch = false,
  ) {
    // score accumulates; the TIER only advances when a player triggers
    // the upgrade (see the "upgrade" message) - never automatically
    this.world = {
      ...this.world,
      sharedScore: this.world.sharedScore + res.points,
    };
    this.broadcast({
      t: "outcome",
      outcome: {
        playerId,
        throwId,
        made: res.made,
        swish: res.swish,
        slam,
        rims: res.rims,
        distM: res.distM,
        points: res.points,
        world: { ...this.world },
      },
    });
    const entry: HistoryEntry & { kind: "outcome" } = {
      kind: "outcome",
      name: playerName,
      made: res.made,
      swish: res.swish,
      slam,
      rims: res.rims,
      distM: res.distM,
      points: res.points,
    };
    this.record(entry);
    // a miss opens the catch window: the thrower may take the ball back
    // while it is physically still on the court (client-detected landing;
    // the server only rules WHOSE throw, WAS a miss, ONCE per ball)
    if (!res.made) {
      this.recentMisses.set(throwId, {
        playerId,
        entry,
        catchable: !bornFromCatch,
        atMs: Date.now(),
      });
      const cutoff = Date.now() - BALANCE.catchBall.windowS * 1000;
      for (const [id, m] of this.recentMisses)
        if (m.atMs < cutoff) this.recentMisses.delete(id);
      // a catch that raced this outcome by a breath lands right now
      const early = this.earlyCatches.get(throwId);
      if (early) {
        this.earlyCatches.delete(throwId);
        this.tryCatch(early.playerId, throwId);
      }
    }
  }

  /**
   * Validate + apply a catch: THEIR throw, ruled a MISS, catchable
   * (not born from a catch), inside the window - then refund (the orb
   * pattern; a UTC day change makes the refund a no-op, the catch still
   * logs), retro-mark the wall line and tell everyone.
   * "unknown" = no such miss (yet) - the caller may park and retry.
   */
  private tryCatch(
    playerId: string,
    throwId: string,
  ): "done" | "unknown" | "refused" {
    const m = this.recentMisses.get(throwId);
    if (!m) return "unknown";
    const occ = this.occupants.get(playerId);
    if (
      !occ ||
      m.playerId !== playerId ||
      !m.catchable ||
      Date.now() - m.atMs > BALANCE.catchBall.windowS * 1000
    )
      return "refused";
    this.recentMisses.delete(throwId); // once per ball
    // it never was a miss: late joiners skip the wall line (the disk
    // log keeps the raw miss - the forever archive stays raw)
    m.entry.caught = true;
    occ.catchCredits++;
    refundThrow(this.budgetFor(occ.profile), new Date());
    void this.storage.saveProfile(occ.profile).catch(logSaveError);
    if (occ.ws)
      send(occ.ws, {
        t: "budget",
        throwsRemaining: remainingThrows(this.budgetFor(occ.profile), new Date()),
      });
    this.record({ kind: "catch", name: occ.info.name }); // also persists
    this.broadcast({
      t: "caught",
      id: playerId,
      name: occ.info.name,
      throwId,
    });
    return "done";
  }

  private broadcast(msg: ServerMsg, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const o of this.occupants.values()) {
      if (!o.ws || o.ws === except) continue; // offline characters can't hear
      if (o.ws.readyState === o.ws.OPEN) o.ws.send(data);
    }
  }
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function logSaveError(err: unknown) {
  console.error("persist failed (state kept in memory):", err);
}

/** Head variant must index a real part texture on every client. */
function clampHead(n: unknown): number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 3
    ? (n as number)
    : 1;
}

const POSE_KINDS = new Set([
  "idle",
  "walk",
  "aim",
  "throw",
  "fall",
  "lie",
  "getup",
  "cheer",
  "point", //    out-of-balls aim hold
  "airpunch", // …and its release jab
]);

/**
 * Pose telemetry is relayed to every client - never let a malformed
 * payload through. Returns a clean copy, or null to drop the message.
 * Positions clamp to the tier's WALKABLE space - the court plus any
 * unlocked stand-in areas (the cheer deck is off-court).
 */
function sanePose(
  s: AvatarState,
  tierId: number,
  zoneOpen: boolean,
): AvatarState | null {
  if (typeof s !== "object" || s === null || typeof s.pose !== "object")
    return null;
  const nums = [s.x, s.d, s.airH, s.angle, s.pose.t];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n)))
    return null;
  if (!POSE_KINDS.has(s.pose.kind)) return null;
  const c = clampToWalkable(s.x, s.d, tierId, zoneOpen);
  const num = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) ? n : undefined;
  return {
    x: c.x,
    d: c.d,
    airH: Math.min(15, Math.max(0, s.airH)),
    facing: s.facing === -1 ? -1 : 1,
    angle: Math.min(180, Math.max(-180, s.angle)),
    pose: {
      kind: s.pose.kind,
      t: Math.min(1e4, Math.max(0, s.pose.t)),
      aimAngle: num(s.pose.aimAngle),
      aimPower: num(s.pose.aimPower),
    },
  };
}

/** Tints are broadcast to every client - keep them valid 24-bit colours. */
function safeTint(n: unknown): number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffff
    ? (n as number)
    : 0xffffff;
}

/** Never trust the client: sanity-check every launch before resolving. */
function validLaunch(l: ThrowLaunch, tierId: number): boolean {
  const nums = [l.shotX, l.shotD, l.x, l.d, l.h, l.vx, l.vh];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n)))
    return false;
  // shooter must stand on the court, outside the keep-out zone
  const c = clampToCourt(l.shotX, l.shotD);
  if (Math.abs(c.x - l.shotX) > 0.01 || Math.abs(c.d - l.shotD) > 0.01)
    return false;
  // release point near the shooter; height sane (slams release from high up)
  if (Math.abs(l.x - l.shotX) > 1.5 || l.h < 0 || l.h > 15) return false;
  // launch speed within the TIER's power ceiling (the ball-range permanent
  // effect raises it) - small float slack
  return (
    Math.hypot(l.vx, l.vh) <= effectivePowerForTier(tierId).maxPowerM * 1.02
  );
}
