import type { WebSocket } from "ws";
import { BALANCE } from "../src/shared/config";
import { clampToCourt, FREE_THROW_X, RIM } from "../src/shared/court";
import type {
  ClientMsg,
  PlayerInfo,
  ServerMsg,
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
    if (this.occupants.size === 0) this.onEmpty();
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
      case "join":
        break; // already joined; ignore
      default:
        break; // throws/chat land in later build steps
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
