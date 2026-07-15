import { WebSocketServer, type WebSocket } from "ws";
import { Room } from "./room";
import { JsonFileStorage } from "./storage";
import type { ClientMsg } from "../src/shared/messages";

// The game server: a WebSocket relay with one Room per lobby id. Lobbies
// are created on demand (keyed by the ?lobby= id from the invite link) and
// torn down when the last player leaves.

const PORT = Number(process.env.PORT ?? 9999);

// Storage is the swap point: JSON files for local dev, Postgres on Render.
const storage = new JsonFileStorage(process.env.DATA_DIR ?? "data");

const rooms = new Map<string, Room>();

function roomFor(lobby: string): Room {
  let room = rooms.get(lobby);
  if (!room) {
    const r = new Room(lobby, storage, () => {
      rooms.delete(lobby);
      console.log(`[room ${lobby}] empty - torn down (state persisted)`);
    });
    rooms.set(lobby, r);
    room = r;
    console.log(`[room ${lobby}] hydrating`);
  }
  return room;
}

const wss = new WebSocketServer({ port: PORT });

wss.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already taken - another game server is running.\n` +
        `Stop it first, or run with a different port: PORT=xxxx npm run server`,
    );
    process.exit(1);
  }
  console.error("server error:", err);
});

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
        if (await r.join(ws, msg.identity, msg.reset === true)) {
          room = r;
          playerId = msg.identity.id;
          console.log(
            `[room ${lobby}] ${msg.identity.name} (${playerId}) joined - ${r.size} here`,
          );
        }
      } else if (msg.t === "admin") {
        // admin CLI (scripts/admin.ts): kick a live lobby so its files
        // can be moved to backup without a write racing the move
        const reply = (ok: boolean, detail: string) =>
          ws.send(JSON.stringify({ t: "admin-result", ok, detail }));
        if (msg.token !== (process.env.ADMIN_TOKEN ?? "dev-admin")) {
          reply(false, "bad token");
          ws.close();
          return;
        }
        const lobby = String(msg.lobby).slice(0, 64);
        const r = rooms.get(lobby);
        const kicked = r?.size ?? 0;
        if (r) {
          rooms.delete(lobby); // before destroy - it must not resurrect
          r.destroy();
          console.log(`[room ${lobby}] removed by admin - kicked ${kicked}`);
        }
        reply(true, r ? `kicked ${kicked} player(s)` : "no live room");
        ws.close();
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

wss.on("listening", () =>
  console.log(`shootDaHoop server listening on ws://localhost:${PORT}`),
);
