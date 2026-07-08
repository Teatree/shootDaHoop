import type { WebSocket } from "ws";
import { BALANCE } from "../src/shared/config";
import { clampToCourt, FREE_THROW_X, RIM } from "../src/shared/court";
import { resolveThrow } from "../src/shared/simulate";
import { tierForScore } from "../src/shared/tiers";
import type {
  ClientMsg,
  PlayerInfo,
  ServerMsg,
  ThrowLaunch,
  WorldState,
} from "../src/shared/messages";

// One live world. Holds who's connected (presence — ephemeral) and the
// shared world state. Presence dies with the socket; world state and
// profiles persist (storage lands in build step 5).
//
// "The loop must never stop": every inbound message is handled inside a
// try/catch upstream (index.ts); a bad event degrades to a skip.

interface Occupant {
  info: PlayerInfo;
  ws: WebSocket;
}

export class Room {
  private occupants = new Map<string, Occupant>();
  private world: WorldState = { sharedScore: 0, tierId: 1 };
  /** outcomes scheduled to fire when the ball "lands" (resolvedAtS) */
  private pending = new Set<{ timer: NodeJS.Timeout; fire: () => void }>();

  constructor(
    readonly lobby: string,
    private readonly onEmpty: () => void,
  ) {}

  get size(): number {
    return this.occupants.size;
  }

  /** Returns true if the join was accepted (welcome sent). */
  join(
    ws: WebSocket,
    identity: { id: string; name: string; shirtColor: number },
  ): boolean {
    const existing = this.occupants.get(identity.id);
    if (!existing && this.occupants.size >= BALANCE.lobby.maxPlayers) {
      send(ws, { t: "join-rejected", reason: "full" });
      return false;
    }

    if (existing) {
      // reconnect: replace the zombie socket, keep the avatar where it was
      try {
        existing.ws.close();
      } catch {
        /* already dead */
      }
      existing.ws = ws;
      existing.info.name = identity.name;
    } else {
      const spawn = clampToCourt(FREE_THROW_X, RIM.d);
      const info: PlayerInfo = {
        id: identity.id,
        name: identity.name,
        shirtColor: identity.shirtColor,
        x: spawn.x,
        d: spawn.d,
      };
      this.occupants.set(identity.id, { info, ws });
      this.broadcast({ t: "player-joined", player: info }, ws);
    }

    send(ws, {
      t: "welcome",
      selfId: identity.id,
      players: [...this.occupants.values()].map((o) => o.info),
      world: { ...this.world },
      throwsRemaining: BALANCE.budget.throwsPerDay, // budget lands in step 7
      history: [], //                                  persistence lands in step 5
    });
    return true;
  }

  leave(playerId: string, ws: WebSocket) {
    const occ = this.occupants.get(playerId);
    if (!occ || occ.ws !== ws) return; // stale socket from a reconnect
    this.occupants.delete(playerId);
    this.broadcast({ t: "player-left", id: playerId, name: occ.info.name });
    if (this.occupants.size === 0) {
      // flush in-flight outcomes so the world state stays consistent
      for (const p of this.pending) {
        clearTimeout(p.timer);
        p.fire();
      }
      this.pending.clear();
      this.onEmpty();
    }
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
        // budget check lands in build step 7
        // the thrower already animates locally — relay to everyone else
        this.broadcast(
          { t: "throw", id: playerId, throwId: msg.throwId, launch: msg.launch },
          occ.ws,
        );
        // authoritative resolution NOW; the outcome fires when the ball
        // "lands" so score juice lines up with the visual flight
        const res = resolveThrow(msg.launch);
        const fire = () =>
          this.applyOutcome(playerId, msg.throwId, msg.launch.slam, res);
        const entry = {
          timer: setTimeout(() => {
            this.pending.delete(entry);
            fire();
          }, Math.max(200, res.resolvedAtS * 1000)),
          fire,
        };
        this.pending.add(entry);
        break;
      }
      case "join":
        break; // already joined; ignore
      default:
        break; // chat lands in build step 6
    }
  }

  private applyOutcome(
    playerId: string,
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
