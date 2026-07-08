import { WebSocketServer, type WebSocket } from "ws";
import { Room } from "./room";
import { JsonFileStorage } from "./storage";
import type { ClientMsg } from "../src/shared/messages";

// The game server: a WebSocket relay with one Room per lobby id. Lobbies
// are created on demand (keyed by the ?lobby= id from the invite link) and
// torn down when the last player leaves.

const PORT = Number(process.env.PORT ?? 8787);

// Storage is the swap point: JSON files for local dev, Postgres on Render.
const storage = new JsonFileStorage(process.env.DATA_DIR ?? "data");

const rooms = new Map<string, Room>();

function roomFor(lobby: string): Room {
  let room = rooms.get(lobby);
  if (!room) {
    const r = new Room(lobby, storage, () => {
      rooms.delete(lobby);
      console.log(`[room ${lobby}] empty — torn down (state persisted)`);
    });
    rooms.set(lobby, r);
    room = r;
    console.log(`[room ${lobby}] hydrating`);
  }
  return room;
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws: WebSocket) => {
  let room: Room | null = null;
  let playerId: string | null = null;

  ws.on("message", async (data) => {
    // the loop must never stop: a bad event degrades to a skip
    try {
      const msg = JSON.parse(String(data)) as ClientMsg;
      if (msg.t === "join") {
        const lobby = String(msg.lobby).slice(0, 64) || "court";
        const r = roomFor(lobby);
        if (await r.join(ws, msg.identity)) {
          room = r;
          playerId = msg.identity.id;
          console.log(
            `[room ${lobby}] ${msg.identity.name} (${playerId}) joined — ${r.size} here`,
          );
        }
      } else if (room && playerId) {
        room.handle(playerId, msg);
      }
    } catch (err) {
      console.error("bad message, skipped:", err);
    }
  });

  ws.on("close", () => {
    try {
      if (room && playerId) room.leave(playerId, ws);
    } catch (err) {
      console.error("leave failed:", err);
    }
  });

  ws.on("error", (err) => console.error("socket error:", err));
});

console.log(`shootDaHoop server listening on ws://localhost:${PORT}`);
