import WebSocket from "ws";
import {
  backupLobby,
  listBackups,
  listLobbies,
  purgeBackup,
  restoreLobby,
} from "../server/adminOps";
import type { ClientMsg, ServerMsg } from "../src/shared/messages";

// Lobby admin CLI - see "Admin: managing lobbies" in README.md.
//
//   npm run admin -- list
//   npm run admin -- remove <lobby>
//   npm run admin -- restore <lobby>
//   npm run admin -- backups
//   npm run admin -- purge-backup <lobby>
//
// `remove` first asks the running server to kick the lobby's players
// (they see a "removed by the admin" notice), then moves the files to
// data/backups/<lobby>/. If the server is down there is nobody to kick,
// so the file move alone is the whole job.

const DATA_DIR = process.env.DATA_DIR ?? "data";
const SERVER = process.env.ADMIN_SERVER ?? "ws://localhost:9999";
const TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin";

const [cmd, lobby] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case "list": {
      const lobbies = await listLobbies(DATA_DIR);
      if (!lobbies.length) return console.log("no lobbies in " + DATA_DIR);
      table(
        ["LOBBY", "PLAYERS", "HOOP TIER", "LAST VISITED"],
        lobbies.map((l) => [
          l.lobby,
          String(l.players),
          String(l.tierId),
          when(l.lastVisited),
        ]),
      );
      break;
    }

    case "remove": {
      const id = await requireLobbyArg();
      // fail fast on a doomed move - don't kick players for nothing
      if ((await listBackups(DATA_DIR)).some((b) => b.lobby === id))
        throw new Error(
          `a backup for "${id}" already exists - restore or purge it first`,
        );
      console.log(await kickViaServer(id));
      await backupLobby(DATA_DIR, id, Date.now());
      console.log(`moved "${id}" to ${DATA_DIR}/backups/${id}/`);
      break;
    }

    case "restore": {
      const id = await requireLobbyArg(listBackups);
      const force = process.argv.includes("--force");
      // --force discards a re-created lobby with the same id: kick its
      // players first so nobody's live socket re-saves the dropped files
      if (force) console.log(await kickViaServer(id));
      await restoreLobby(DATA_DIR, id, force);
      console.log(`restored "${id}" with all progress`);
      break;
    }

    case "backups": {
      const backups = await listBackups(DATA_DIR);
      if (!backups.length) return console.log("no backups");
      table(
        ["LOBBY", "REMOVED"],
        backups.map((b) => [b.lobby, when(b.removedAt)]),
      );
      break;
    }

    case "purge-backup": {
      const id = await requireLobbyArg(listBackups);
      await purgeBackup(DATA_DIR, id);
      console.log(`permanently deleted ${DATA_DIR}/backups/${id}/`);
      break;
    }

    default:
      console.log(
        "usage: npm run admin -- <list | remove <lobby> | restore <lobby>" +
          " | backups | purge-backup <lobby>>",
      );
      process.exitCode = 1;
  }
}

/**
 * Ask the running server to kick everyone out of the lobby first, so no
 * live socket writes race the file move. A dead server means an empty
 * lobby - carry on with the move.
 */
function kickViaServer(lobby: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve("server unreachable - treating lobby as offline");
    }, 2000);
    ws.on("open", () => {
      const msg: ClientMsg = { t: "admin", token: TOKEN, cmd: "remove", lobby };
      ws.send(JSON.stringify(msg));
    });
    ws.on("message", (data) => {
      clearTimeout(timer);
      ws.close();
      const res = JSON.parse(String(data)) as ServerMsg;
      if (res.t !== "admin-result") return;
      if (res.ok) resolve(`server: ${res.detail}`);
      else reject(new Error(`server refused: ${res.detail}`));
    });
    ws.on("error", () => {
      clearTimeout(timer);
      resolve("server unreachable - treating lobby as offline");
    });
  });
}

async function requireLobbyArg(
  known: (dir: string) => Promise<{ lobby: string }[]> = listLobbies,
): Promise<string> {
  if (lobby) return lobby;
  console.error(`"${cmd}" needs a lobby id. Known:`);
  for (const l of await known(DATA_DIR)) console.error(`  ${l.lobby}`);
  process.exit(1);
}

function when(at: number): string {
  return at ? new Date(at).toLocaleString() : "unknown";
}

function table(header: string[], rows: string[][]) {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (r: string[]) =>
    r.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  for (const r of rows) console.log(line(r));
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
