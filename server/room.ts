import type { WebSocket } from "ws";
import { BALANCE } from "../src/shared/config";
import { clampToCourt, rollSpawn } from "../src/shared/court";
import { resolveThrow } from "../src/shared/simulate";
import { tierForScore } from "../src/shared/tiers";
import type {
  ClientMsg,
  HistoryEntry,
  PlayerInfo,
  ServerMsg,
  ThrowLaunch,
  WorldState,
} from "../src/shared/messages";
import type { PlayerProfile, Storage } from "./storage";
import { consumeThrow, refundThrow, remainingThrows } from "./budget";
import { OrbAuthority } from "./orb";

// One live world. Holds who's connected (presence — ephemeral) and the
// shared world state. Presence dies with the socket; world state and
// profiles persist (storage lands in build step 5).
//
// "The loop must never stop": every inbound message is handled inside a
// try/catch upstream (index.ts); a bad event degrades to a skip.

interface Occupant {
  info: PlayerInfo;
  ws: WebSocket;
  profile: PlayerProfile;
  /** epoch ms until which a slam throw is legitimate (set on teleport) */
  levitatingUntil: number;
}

export class Room {
  private occupants = new Map<string, Occupant>();
  private world: WorldState = { sharedScore: 0, tierId: 1 };
  private history: HistoryEntry[] = [];
  /** outcomes scheduled to fire when the ball "lands" (resolvedAtS) */
  private pending = new Set<{ timer: NodeJS.Timeout; fire: () => void }>();
  /** full-ish snapshots: late joiners and dropped packets self-heal */
  private snapshotTimer: NodeJS.Timeout | null = null;
  /** the teleport orb — a server-authoritative world object (see orb.ts) */
  private readonly orb: OrbAuthority;
  /** resolves once the world bundle is hydrated — join() waits on this */
  readonly ready: Promise<void>;

  constructor(
    readonly lobby: string,
    private readonly storage: Storage,
    private readonly onEmpty: () => void,
  ) {
    this.ready = this.hydrate();
    this.orb = new OrbAuthority({
      onSpawn: (orb) => this.broadcast({ t: "orb-spawned", orb }),
      onExpire: (seq) => this.broadcast({ t: "orb-removed", seq }),
    });
    this.snapshotTimer = setInterval(() => {
      if (this.occupants.size === 0) return;
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

  get size(): number {
    return this.occupants.size;
  }

  /** Returns true if the join was accepted (welcome sent). */
  async join(
    ws: WebSocket,
    identity: { id: string; name: string; shirtColor: number },
    reset = false,
  ): Promise<boolean> {
    await this.ready;
    const existing = this.occupants.get(identity.id);
    if (!existing && this.occupants.size >= BALANCE.lobby.maxPlayers) {
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

    // profile is persistent and travels across worlds
    const profile: PlayerProfile = (await this.storage.loadProfile(
      identity.id,
    )) ?? {
      id: identity.id,
      name: identity.name,
      shirtColor: identity.shirtColor,
      throwsUsedToday: 0,
      lastThrowDayUTC: "",
    };
    profile.name = identity.name;
    profile.shirtColor = identity.shirtColor;
    void this.storage.saveProfile(profile).catch(logSaveError);

    if (existing) {
      // reconnect: replace the zombie socket, keep the avatar where it was
      try {
        existing.ws.close();
      } catch {
        /* already dead */
      }
      existing.ws = ws;
      existing.info.name = identity.name;
      existing.profile = profile;
    } else {
      const spawn = rollSpawn(); // random spot beside the keep-out zone
      const info: PlayerInfo = {
        id: identity.id,
        name: identity.name,
        shirtColor: identity.shirtColor,
        x: spawn.x,
        d: spawn.d,
      };
      this.occupants.set(identity.id, { info, ws, profile, levitatingUntil: 0 });
      this.broadcast({ t: "player-joined", player: info }, ws);
      this.record({ kind: "presence", name: identity.name, joined: true });
    }

    send(ws, {
      t: "welcome",
      selfId: identity.id,
      players: [...this.occupants.values()].map((o) => o.info),
      world: { ...this.world },
      orb: this.orb.current,
      throwsRemaining: remainingThrows(profile, new Date()),
      history: this.history.slice(0, -1), // minus our own join, logged live
    });
    return true;
  }

  leave(playerId: string, ws: WebSocket) {
    const occ = this.occupants.get(playerId);
    if (!occ || occ.ws !== ws) return; // stale socket from a reconnect
    this.occupants.delete(playerId);
    this.broadcast({ t: "player-left", id: playerId, name: occ.info.name });
    this.record({ kind: "presence", name: occ.info.name, joined: false });
    if (this.occupants.size === 0) {
      // flush in-flight outcomes so the world state stays consistent
      for (const p of this.pending) {
        clearTimeout(p.timer);
        p.fire();
      }
      this.pending.clear();
      if (this.snapshotTimer) clearInterval(this.snapshotTimer);
      this.orb.stop();
      this.onEmpty();
    }
  }

  /** Append to the wall history and persist the bundle — save on event. */
  private record(entry: HistoryEntry) {
    // the permanent archive gets EVERY entry, forever, per lobby —
    // the in-memory wall below stays capped for welcome replay
    void this.storage
      .appendLog(this.lobby, { at: Date.now(), ...entry })
      .catch(logSaveError);
    this.history.push(entry);
    if (this.history.length > BALANCE.lobby.historyKept)
      this.history = this.history.slice(-BALANCE.lobby.historyKept);
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
    if (!occ) return;

    switch (msg.t) {
      case "move-to": {
        const c = clampToCourt(msg.x, msg.d);
        occ.info.x = c.x;
        occ.info.d = c.d;
        // intent broadcast — the sender already animates locally
        this.broadcast({ t: "move-to", id: playerId, x: c.x, d: c.d }, occ.ws);
        break;
      }
      case "throw": {
        if (!validLaunch(msg.launch)) {
          send(occ.ws, {
            t: "throw-rejected",
            throwId: msg.throwId,
            reason: "invalid",
          });
          break;
        }
        // the budget is the server's, not the client's
        if (!consumeThrow(occ.profile, new Date())) {
          send(occ.ws, {
            t: "throw-rejected",
            throwId: msg.throwId,
            reason: "budget",
          });
          break;
        }
        void this.storage.saveProfile(occ.profile).catch(logSaveError);
        send(occ.ws, {
          t: "budget",
          throwsRemaining: remainingThrows(occ.profile, new Date()),
        });
        // never trust the client: a slam only counts if WE teleported
        // this player moments ago (the orb is server-side now)
        const slam = msg.launch.slam && Date.now() < occ.levitatingUntil;
        const launch: ThrowLaunch = { ...msg.launch, slam };
        // the thrower already animates locally — relay to everyone else
        this.broadcast(
          { t: "throw", id: playerId, throwId: msg.throwId, launch },
          occ.ws,
        );
        // authoritative resolution NOW; the outcome fires when the ball
        // "lands" so score juice lines up with the visual flight
        const orb = this.orb.current;
        const res = resolveThrow(launch, orb);
        const playerName = occ.info.name; // captured — they may leave mid-flight
        if (res.orbHitAtS !== undefined && orb) {
          // ruled to hit the orb — confirm when the ball visually gets
          // there; if the orb is gone by then (expired / another ball
          // took it), the throw plays out as a plain arc instead
          const orbSeq = orb.seq;
          const plain = resolveThrow(launch);
          const hitAtS = res.orbHitAtS;
          this.schedule(
            () =>
              this.resolveOrbHit(playerId, playerName, msg.throwId, orbSeq, {
                plain,
                hitAtS,
                slam,
              }),
            hitAtS * 1000,
          );
        } else {
          this.schedule(
            () => this.applyOutcome(playerId, playerName, msg.throwId, slam, res),
            Math.max(200, res.resolvedAtS * 1000),
          );
        }
        break;
      }
      case "chat": {
        const text = String(msg.text).slice(0, 1000).trim();
        if (!text) break;
        // to EVERYONE including the sender — one render path on the client
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
   * until now, consume it and teleport the thrower (broadcast to all —
   * clients that predicted it locally dedupe by seq). Otherwise fall
   * back to the plain-arc outcome, waiting out the rest of the flight.
   */
  private resolveOrbHit(
    playerId: string,
    playerName: string,
    throwId: string,
    orbSeq: number,
    opts: { plain: ReturnType<typeof resolveThrow>; hitAtS: number; slam: boolean },
  ) {
    const taken = this.orb.consume(orbSeq);
    if (taken) {
      const occ = this.occupants.get(playerId);
      if (occ) {
        occ.levitatingUntil =
          Date.now() + (BALANCE.orb.levitateS + 1.5) * 1000;
        occ.info.x = taken.x; // snapshots self-heal to the landing spot
        // hitting the orb keeps the ball — the slam is a FREE throw
        refundThrow(occ.profile, new Date());
        void this.storage.saveProfile(occ.profile).catch(logSaveError);
        send(occ.ws, {
          t: "budget",
          throwsRemaining: remainingThrows(occ.profile, new Date()),
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
      () => this.applyOutcome(playerId, playerName, throwId, opts.slam, opts.plain),
      Math.max(0, (opts.plain.resolvedAtS - opts.hitAtS) * 1000),
    );
  }

  private applyOutcome(
    playerId: string,
    playerName: string,
    throwId: string,
    slam: boolean,
    res: ReturnType<typeof resolveThrow>,
  ) {
    const prevTier = this.world.tierId;
    this.world = {
      sharedScore: this.world.sharedScore + res.points,
      tierId: tierForScore(this.world.sharedScore + res.points).id,
    };
    this.broadcast({
      t: "outcome",
      outcome: {
        playerId,
        throwId,
        made: res.made,
        swish: res.swish,
        slam,
        distM: res.distM,
        points: res.points,
        world: { ...this.world },
      },
    });
    this.record({
      kind: "outcome",
      name: playerName,
      made: res.made,
      swish: res.swish,
      slam,
      distM: res.distM,
      points: res.points,
    });
    if (this.world.tierId !== prevTier) {
      this.broadcast({
        t: "tier-unlock",
        tierId: this.world.tierId,
        world: { ...this.world },
      });
    }
  }

  private broadcast(msg: ServerMsg, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const o of this.occupants.values()) {
      if (o.ws === except) continue;
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

/** Never trust the client: sanity-check every launch before resolving. */
function validLaunch(l: ThrowLaunch): boolean {
  const nums = [l.shotX, l.shotD, l.x, l.d, l.h, l.vx, l.vh];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n)))
    return false;
  // shooter must stand on the court, outside the keep-out zone
  const c = clampToCourt(l.shotX, l.shotD);
  if (Math.abs(c.x - l.shotX) > 0.01 || Math.abs(c.d - l.shotD) > 0.01)
    return false;
  // release point near the shooter; height sane (slams release from high up)
  if (Math.abs(l.x - l.shotX) > 1.5 || l.h < 0 || l.h > 15) return false;
  // launch speed within the power curve's ceiling (small float slack)
  return Math.hypot(l.vx, l.vh) <= BALANCE.power.maxPowerM * 1.02;
}
