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
  MAX_EXPECTED_PLAYERS,
  MIN_EXPECTED_PLAYERS,
  canUpgrade,
  cheerDeckForTier,
  clampToWalkable,
  effectivePowerForTier,
  hoopMotionForTier,
  interactiveSpots,
  interactivesForTier,
  nextTier,
  orbTimingForTier,
} from "../src/shared/tierRules";
import { clampLaunchStamp } from "../src/shared/hoopMotion";
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
import type { OfflineCharacter, PlayerProfile, Storage } from "./storage";
import {
  consumeThrow,
  msToNextBall,
  refundThrow,
  remainingThrows,
  sanitizeBudget,
  type BudgetFields,
} from "../src/shared/budget";
import { OrbAuthority } from "./orb";
import { track } from "./analytics";

// One live world. Holds who's here (presence) and the shared world state.
// A DISCONNECT does not despawn the character: the occupant goes OFFLINE
// (ws = null, tag grayed on every client) and the character waits around -
// after a short delay it walks to a waiting spot (the cheer deck if it
// exists, else the far sideline) and stays until its player rejoins.
// The lineup SURVIVES the room (owner ask 2026-07-18): offline
// characters ride the world bundle, so a server restart or a
// last-player-leaves teardown re-seats them on the next hydrate and a
// returning player reclaims their own statue. World state and profiles
// persist via storage.
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
  /** the offline lineup slot this character parked in (null = not parked) */
  waitSlot: number | null;
  /** the cheer-deck spot this offline character parked on (null = not
   *  on the deck) - deck seats fill before the sideline lineup */
  deckSlot: number | null;
  /** epoch ms of the disconnect (0 = never went offline) - persisted
   *  with the bundle so hydrate can prune long-abandoned characters */
  offlineSinceMs: number;
  // ── analytics bookkeeping (docs/analytics.md) - never gameplay ─────
  /** when this connection began - the sessions tab's leave row */
  joinedAtMs: number;
  throwsThisSession: number;
  /** brand-new profile - its first throw ever is a growth event */
  firstThrowPending: boolean;
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
  /** who threw what - a recording upload must match its thrower
   *  (bounded; old entries roll off) */
  private throwOwners = new Map<string, string>();

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

  /** No bundle existed at hydrate - the FIRST join creates this world
   *  and may size it via the invite link's ?players=N (one shot). */
  private freshWorld = false;

  private async hydrate() {
    const bundle = await this.storage.loadWorld(this.lobby);
    if (bundle) {
      this.world = bundle.world;
      // defensive: a hand-edited bundle at a moving-hoop tier without a
      // schedule would leave the hoop frozen - synthesize one
      if (hoopMotionForTier(this.world.tierId) && !this.world.hoopMotion) {
        this.world = {
          ...this.world,
          hoopMotion: {
            seed: (Math.random() * 0xffffffff) >>> 0,
            anchorMs: Date.now(),
          },
        };
      }
      this.history = bundle.history ?? [];
      this.seedOfflineLineup(bundle.offline ?? []);
    } else {
      this.freshWorld = true;
    }
  }

  /**
   * Re-seat the persisted AFK lineup (owner ask 2026-07-18). Runs
   * before the first join resolves (join awaits `ready`), so the
   * statues are already in the welcome list. They park STRAIGHT at
   * their lineup slots - nobody is connected during hydration, so
   * there is no walk to animate. A later join() with a matching id is
   * the reclaim, the exact same path as a live-room rejoin.
   */
  private seedOfflineLineup(chars: OfflineCharacter[]) {
    const p = BALANCE.presence;
    const now = Date.now();
    const kept = chars
      .filter((c) => now - c.offlineSinceMs < p.offlineKeepH * 3_600_000)
      .sort((a, b) => b.offlineSinceMs - a.offlineSinceMs)
      .slice(0, p.offlineKeptMax);
    kept.forEach((c) => {
      // the cheer deck seats fill first (owner ask 2026-07-18: AFK
      // characters belong ON the platform when the world has one);
      // overflow parks along the sideline lineup as before
      const deck = this.freeDeckSlot();
      const waitSlot = deck ? null : this.freeWaitSlot();
      const spot = deck
        ? deck.spot // off-court by design - never run through clampToCourt
        : clampToCourt(
            p.waitLineStartXM - (waitSlot as number) * p.waitLineGapM,
            p.waitLineDM,
          );
      // stored data, but it crossed a disk/database - clamp the visuals
      // like a join; the id stays VERBATIM (it is the reclaim match key,
      // and it is exactly what persistWorld wrote)
      const info: PlayerInfo = {
        id: String(c.id),
        name: String(c.name).slice(0, 40),
        shirtColor: safeTint(c.shirtColor),
        skinTint: safeTint(c.skinTint),
        lowerTint: safeTint(c.lowerTint),
        headVariant: clampHead(c.headVariant),
        x: spot.x,
        d: spot.d,
        offline: true,
      };
      this.occupants.set(info.id, {
        info,
        ws: null,
        // a stub - join() loads the real profile at reclaim, and an
        // offline occupant can't act (handle() gates on the socket)
        profile: { id: info.id, name: info.name, shirtColor: info.shirtColor },
        levitatingUntil: 0,
        offlineWalkTimer: null,
        catchCredits: 0,
        waitSlot,
        deckSlot: deck ? deck.slot : null,
        offlineSinceMs: c.offlineSinceMs,
        joinedAtMs: c.offlineSinceMs,
        throwsThisSession: 0,
        firstThrowPending: false,
      });
    });
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
    players?: number,
  ): Promise<boolean> {
    await this.ready;
    if (this.freshWorld) {
      // the creating join sizes the court - once; later joins (and any
      // hand-tweaked ?players on the same link) change nothing. Stored
      // explicitly, default included, so the bundle shows the choice.
      this.freshWorld = false;
      this.world = {
        ...this.world,
        expectedPlayers: clampExpectedPlayers(players),
      };
    }
    const existing = this.occupants.get(identity.id);
    // capacity counts CONNECTED players - a waiting offline character
    // must never lock its own player (or friends) out
    if (!existing && this.connectedCount() >= BALANCE.lobby.maxPlayers) {
      send(ws, { t: "join-rejected", reason: "full" });
      track("ops", this.lobby, identity.id, "join_rejected_full", "");
      return false;
    }

    if (reset) {
      // the ?reset link: wipe the world's shared score (the communal
      // progression), keep the wall + everyone's daily budgets - and
      // the court's size (expectedPlayers is for life)
      this.world = {
        sharedScore: 0,
        tierId: 1,
        expectedPlayers: this.world.expectedPlayers,
      };
      this.record({ kind: "reset", name: identity.name }); // also persists
      track(
        "progression",
        this.lobby,
        identity.id,
        "score_reset",
        1,
        this.connectedCount(),
      );
      this.broadcast({
        t: "world-reset",
        name: identity.name,
        world: { ...this.world },
      }); // the joiner learns via its own welcome below
    }

    // profile is persistent and travels across worlds (budgets are kept
    // per lobby inside it - see budgetFor)
    const stored = await this.storage.loadProfile(identity.id);
    // a profile the storage has never seen = a player the GAME has never
    // seen - and lobby joins only happen through invite links
    const isNew = !stored;
    const profile: PlayerProfile = stored ?? {
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
        // a reclaim starts a fresh session; a zombie-socket swap doesn't
        existing.joinedAtMs = Date.now();
        existing.throwsThisSession = 0;
        existing.waitSlot = null; // the lineup spot frees up
        existing.deckSlot = null; // ...and so does the deck seat
        existing.offlineSinceMs = 0;
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
        waitSlot: null,
        deckSlot: null,
        offlineSinceMs: 0,
        joinedAtMs: Date.now(),
        throwsThisSession: 0,
        firstThrowPending: isNew,
      });
      this.broadcast({ t: "player-joined", player: info }, ws);
      this.record({ kind: "presence", name: identity.name, joined: true });
    }

    track(
      "sessions",
      this.lobby,
      identity.id,
      "join",
      identity.name,
      isNew ? 1 : 0,
    );
    // fresh profile arriving at a lobby = an invite link converted
    if (isNew) track("growth", this.lobby, identity.id, "invite_opened");

    send(ws, {
      t: "welcome",
      selfId: identity.id,
      players: [...this.occupants.values()].map((o) => o.info),
      world: { ...this.world },
      orb: this.orb.current,
      // AFK earnings land right here: budgetFor sanitizes + refreshes,
      // so the count already includes every ball the clock owed
      ...this.budgetPayload(profile),
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
    occ.offlineSinceMs = Date.now();
    this.broadcast({ t: "player-offline", id: playerId, name: occ.info.name });
    this.record({ kind: "presence", name: occ.info.name, joined: false });
    track(
      "sessions",
      this.lobby,
      playerId,
      "leave",
      occ.info.name,
      "",
      Math.round((Date.now() - occ.joinedAtMs) / 1000),
      occ.throwsThisSession,
    );
    this.scheduleOfflineWalk(playerId, occ);
    if (this.connectedCount() === 0) {
      // last CONNECTED player gone: flush in-flight outcomes so the
      // world state stays consistent, then tear down - the offline
      // characters ride the just-persisted bundle and re-seat on the
      // next hydrate (this leave's record() saved them, leaver included)
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
   * After offlineWalkDelayS the abandoned character walks to a waiting
   * spot: a CHEER DECK seat when the world has one (owner ask
   * 2026-07-18 - the statue weary-cheers up there), else the offline
   * LINEUP (owner ask 2026-07-17): a row of slots along the far
   * sideline, slot 0 as close to the hoop as the furniture allows, one
   * gap apart - grayed statues waiting side by side. A normal move
   * intent, so every client animates the walk; the spot frees when
   * they rejoin. Deck seats are off-court on purpose - the client's
   * move clamp (clampToWalkable) admits the deck footprint.
   */
  private scheduleOfflineWalk(playerId: string, occ: Occupant) {
    if (occ.offlineWalkTimer) clearTimeout(occ.offlineWalkTimer);
    occ.offlineWalkTimer = setTimeout(() => {
      occ.offlineWalkTimer = null;
      if (occ.ws !== null) return; // reclaimed in the meantime
      const p = BALANCE.presence;
      const deck = this.freeDeckSlot();
      let spot: { x: number; d: number };
      if (deck) {
        occ.deckSlot = deck.slot;
        spot = deck.spot;
      } else {
        occ.waitSlot = this.freeWaitSlot();
        spot = clampToCourt(
          p.waitLineStartXM - occ.waitSlot * p.waitLineGapM,
          p.waitLineDM,
        );
      }
      occ.info.x = spot.x;
      occ.info.d = spot.d;
      this.broadcast({ t: "move-to", id: playerId, x: spot.x, d: spot.d });
    }, BALANCE.presence.offlineWalkDelayS * 1000);
  }

  /** The lowest lineup slot no other parked offline character holds. */
  private freeWaitSlot(): number {
    const used = new Set<number>();
    for (const o of this.occupants.values())
      if (o.ws === null && o.waitSlot !== null) used.add(o.waitSlot);
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }

  /** The first free cheer-deck seat, or null when the tier has no deck
   *  or every seat already holds a parked statue (overflow -> lineup). */
  private freeDeckSlot(): {
    slot: number;
    spot: { x: number; d: number };
  } | null {
    const deck = cheerDeckForTier(this.world.tierId);
    if (!deck) return null;
    const spots = interactiveSpots(deck);
    const used = new Set<number>();
    for (const o of this.occupants.values())
      if (o.ws === null && o.deckSlot !== null) used.add(o.deckSlot);
    for (let i = 0; i < spots.length; i++)
      if (!used.has(i)) return { slot: i, spot: spots[i] };
    return null;
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
    // sanitize on EVERY read, not ??= - stored records from the daily
    // era (or corrupt ones) hydrate to a fresh full rack (budget.ts)
    return (profile.budgets[this.lobby] = sanitizeBudget(
      profile.budgets[this.lobby],
      new Date(),
    ));
  }

  /** The budget message payload - the count plus the regen countdown
   *  (a DURATION, so client clock skew can't bend it). */
  private budgetPayload(profile: PlayerProfile) {
    const b = this.budgetFor(profile);
    const now = new Date();
    const ms = msToNextBall(b, now);
    return {
      throwsRemaining: remainingThrows(b, now),
      nextBallInS: ms === null ? null : Math.ceil(ms / 1000),
    };
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
        offline: this.offlineRoster(),
      })
      .catch(logSaveError);
  }

  /** Every waiting character, as hydrate will re-seat them. Computed at
   *  save time, so any persisting event keeps the lineup current - the
   *  leave() that put a character offline records presence and saves. */
  private offlineRoster(): OfflineCharacter[] {
    return [...this.occupants.values()]
      .filter((o) => o.ws === null)
      .map((o) => ({ ...o.info, offlineSinceMs: o.offlineSinceMs }));
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
          // RESYNC BEFORE REJECTING: the client's local regen sim may
          // have minted a phantom ball (clock drift) - without a fresh
          // count its gate would let it retry-reject forever (no
          // midnight self-heal exists anymore)
          send(sock, { t: "budget", ...this.budgetPayload(occ.profile) });
          send(sock, {
            t: "throw-rejected",
            throwId: msg.throwId,
            reason: "budget",
          });
          break;
        }
        void this.storage.saveProfile(occ.profile).catch(logSaveError);
        send(sock, { t: "budget", ...this.budgetPayload(occ.profile) });
        occ.throwsThisSession++;
        if (occ.firstThrowPending) {
          occ.firstThrowPending = false;
          track("growth", this.lobby, playerId, "first_throw");
        }
        // remember whose throw this is - the recording upload checks it
        this.throwOwners.set(msg.throwId, playerId);
        if (this.throwOwners.size > 300) {
          const oldest = this.throwOwners.keys().next().value;
          if (oldest !== undefined) this.throwOwners.delete(oldest);
        }
        // never trust the client: a slam only counts if WE teleported
        // this player moments ago (the orb is server-side now); the
        // launch stamp (the moving hoop's timeline anchor) is clamped
        // to a small window around arrival - and relayed CLAMPED, so
        // every viewer steps the same hoop timeline the resolver did
        const slam = msg.launch.slam && Date.now() < occ.levitatingUntil;
        const launch: ThrowLaunch = {
          ...msg.launch,
          slam,
          atMs: clampLaunchStamp(msg.launch.atMs, Date.now()),
        };
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
        const res = resolveThrow(
          launch,
          orb,
          this.world.tierId,
          this.world.hoopMotion,
        );
        const playerName = occ.info.name; // captured - they may leave mid-flight
        if (res.orbHitAtS !== undefined && orb) {
          // ruled to hit the orb - confirm when the ball visually gets
          // there; if the orb is gone by then (expired / another ball
          // took it), the throw plays out as a plain arc instead
          const orbSeq = orb.seq;
          const plain = resolveThrow(
            launch,
            null,
            this.world.tierId,
            this.world.hoopMotion,
          );
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
          // in the wild this usually means A STALE SERVER BUILD - the
          // ops eye wants to see it happening
          track(
            "progression",
            this.lobby,
            playerId,
            "upgrade_rejected_threshold",
            this.world.tierId,
            this.connectedCount(),
          );
          break;
        }
        if (
          Math.hypot(occ.info.x - RIM.x, occ.info.d - RIM.d) >
          BALANCE.upgrade.proximityM
        ) {
          send(sock, { t: "upgrade-rejected", reason: "proximity" });
          track(
            "progression",
            this.lobby,
            playerId,
            "upgrade_rejected_proximity",
            this.world.tierId,
            this.connectedCount(),
          );
          break;
        }
        // the next tier counts fresh from zero (the court keeps its
        // size); a moving-hoop tier gets its schedule rolled HERE - one
        // seed + anchor, and every client (and any restart) replays the
        // same timeline (shared/hoopMotion.ts)
        this.world = {
          sharedScore: 0,
          tierId: next.id,
          expectedPlayers: this.world.expectedPlayers,
          hoopMotion: hoopMotionForTier(next.id)
            ? { seed: (Math.random() * 0xffffffff) >>> 0, anchorMs: Date.now() }
            : null,
        };
        // teleport every active player clear of the hoop - but a PARKED
        // offline statue keeps its waiting spot (deck seat / lineup
        // slot): those already stand clear, and scattering them undid
        // the seating (seen live 2026-07-18)
        const placements = [...this.occupants.entries()].map(([id, o]) => {
          if (o.ws === null && (o.deckSlot !== null || o.waitSlot !== null))
            return { id, x: o.info.x, d: o.info.d };
          const spot = rollUpgradeClearSpot();
          o.info.x = spot.x;
          o.info.d = spot.d;
          return { id, x: spot.x, d: spot.d };
        });
        this.record({ kind: "upgrade", name: occ.info.name, tierId: next.id });
        track(
          "progression",
          this.lobby,
          playerId,
          "tier_unlock",
          next.id,
          this.connectedCount(),
        );
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
        track("features", this.lobby, playerId, "jukebox", "play", song);
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
        track("features", this.lobby, playerId, "jukebox", "off", "");
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
        // count + length only - message CONTENT never leaves the game
        track("features", this.lobby, playerId, "chat", "msg", text.length);
        break;
      }
      case "recording": {
        // the finished ghost recording of an own throw, stored so any
        // player can replay the wall line - forever (owner 2026-07-17).
        // Never trust the client: the throw must be THEIRS, and the
        // payload capped (a full recording runs ~50 KB of samples)
        if (this.throwOwners.get(msg.throwId) !== playerId) break;
        if (JSON.stringify(msg.rec).length > 262144) break;
        void this.storage
          .saveRecording(this.lobby, msg.throwId, msg.rec)
          .catch(logSaveError);
        break;
      }
      case "get-recording": {
        // a wall line was clicked - answer the requester only
        void this.storage
          .loadRecording(this.lobby, msg.throwId)
          .then((rec) => send(sock, { t: "recording", throwId: msg.throwId, rec }))
          .catch(() =>
            send(sock, { t: "recording", throwId: msg.throwId, rec: null }),
          );
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
          send(occ.ws, { t: "budget", ...this.budgetPayload(occ.profile) });
      }
      this.broadcast({ t: "orb-removed", seq: orbSeq, byId: playerId });
      track("features", this.lobby, playerId, "orb", "teleport", "");
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
      throwId, // late joiners fetch this throw's stored ghost by it
    };
    this.record(entry);
    const thrower = this.occupants.get(playerId); // may have left mid-flight
    track(
      "throws",
      this.lobby,
      playerId,
      Math.round(res.distM * 100) / 100,
      res.swish ? "swish" : res.made ? "hit" : "miss",
      res.points,
      res.rims,
      this.world.tierId,
      thrower
        ? remainingThrows(this.budgetFor(thrower.profile), new Date())
        : "",
    );
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
      send(occ.ws, { t: "budget", ...this.budgetPayload(occ.profile) });
    this.record({ kind: "catch", name: occ.info.name }); // also persists
    track("features", this.lobby, playerId, "catch", "done", "");
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

/** The invite link's court size, over the wire - keep it 2-5, whole. */
function clampExpectedPlayers(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.min(
        MAX_EXPECTED_PLAYERS,
        Math.max(MIN_EXPECTED_PLAYERS, Math.round(n)),
      )
    : 3;
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
  "dance", //    the /dance chat command
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
