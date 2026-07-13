import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupLobby,
  listBackups,
  listLobbies,
  purgeBackup,
  restoreLobby,
} from "./adminOps";

// The admin toolset behind `npm run admin`. "Remove" must be a lossless
// move (restore brings every byte back); only purgeBackup deletes.

describe("adminOps", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sdh-admin-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const seedLobby = async (lobby: string, opts?: { log?: boolean }) => {
    await mkdir(join(dir, "worlds"), { recursive: true });
    const world = JSON.stringify({
      lobby,
      world: { sharedScore: 777, tierId: 2 },
      history: [{ kind: "reset", name: "Ann" }],
    });
    await writeFile(join(dir, "worlds", `${lobby}.json`), world, "utf8");
    if (opts?.log !== false) {
      await mkdir(join(dir, "logs"), { recursive: true });
      const lines = [
        { at: 100, kind: "presence", name: "Ann", joined: true },
        { at: 200, kind: "presence", name: "Bob", joined: true },
        { at: 300, kind: "presence", name: "Ann", joined: false },
        { at: 400, kind: "presence", name: "Ann", joined: true },
        { at: 500, kind: "chat", name: "Bob", text: "nice" },
      ];
      await writeFile(
        join(dir, "logs", `${lobby}.jsonl`),
        lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
        "utf8",
      );
    }
    return world;
  };

  describe("listLobbies", () => {
    it("reports tier, distinct joined names, and the last event time", async () => {
      await seedLobby("court-a");
      const [l] = await listLobbies(dir);
      expect(l).toEqual({
        lobby: "court-a",
        players: 2, // Ann joined twice, Bob once → 2 distinct names
        tierId: 2,
        lastVisited: 500,
      });
    });

    it("falls back to file mtime when there is no log", async () => {
      await seedLobby("court-b", { log: false });
      const mtime = (await stat(join(dir, "worlds", "court-b.json"))).mtimeMs;
      const [l] = await listLobbies(dir);
      expect(l.players).toBe(0);
      expect(l.lastVisited).toBe(mtime);
    });

    it("is empty when the data dir has no worlds", async () => {
      expect(await listLobbies(dir)).toEqual([]);
    });
  });

  describe("backup / restore round trip", () => {
    it("moves both files out and restores them byte-identical", async () => {
      const world = await seedLobby("court-a");
      const log = await readFile(join(dir, "logs", "court-a.jsonl"), "utf8");

      await backupLobby(dir, "court-a", 12345);
      // gone from the live dirs...
      await expect(stat(join(dir, "worlds", "court-a.json"))).rejects.toThrow();
      await expect(stat(join(dir, "logs", "court-a.jsonl"))).rejects.toThrow();
      // ...and sitting in the backup with its meta
      expect(await listBackups(dir)).toEqual([
        { lobby: "court-a", removedAt: 12345 },
      ]);

      await restoreLobby(dir, "court-a");
      expect(await readFile(join(dir, "worlds", "court-a.json"), "utf8")).toBe(
        world,
      );
      expect(await readFile(join(dir, "logs", "court-a.jsonl"), "utf8")).toBe(
        log,
      );
      expect(await listBackups(dir)).toEqual([]); // backup consumed
    });

    it("backs up a lobby that never got a log file", async () => {
      await seedLobby("court-b", { log: false });
      await backupLobby(dir, "court-b", 1);
      await restoreLobby(dir, "court-b");
      expect((await listLobbies(dir))[0].lobby).toBe("court-b");
    });

    it("refuses to back up an unknown lobby", async () => {
      await expect(backupLobby(dir, "ghost", 1)).rejects.toThrow(
        /no such lobby/,
      );
    });

    it("refuses to overwrite an existing backup", async () => {
      await seedLobby("court-a");
      await backupLobby(dir, "court-a", 1);
      await seedLobby("court-a"); // someone re-created it
      await expect(backupLobby(dir, "court-a", 2)).rejects.toThrow(
        /already exists/,
      );
    });

    it("refuses to restore over a live lobby", async () => {
      await seedLobby("court-a");
      await backupLobby(dir, "court-a", 1);
      await seedLobby("court-a"); // re-created via the old link
      await expect(restoreLobby(dir, "court-a")).rejects.toThrow(/--force/);
    });

    it("force-restore discards the re-created lobby and brings the backup back", async () => {
      const original = await seedLobby("court-a");
      await backupLobby(dir, "court-a", 1);
      await seedLobby("court-a"); // fresh same-id lobby
      await restoreLobby(dir, "court-a", true);
      expect(await readFile(join(dir, "worlds", "court-a.json"), "utf8")).toBe(
        original,
      );
      expect(await listBackups(dir)).toEqual([]);
    });

    it("refuses to restore a lobby with no backup", async () => {
      await expect(restoreLobby(dir, "ghost")).rejects.toThrow(/no backup/);
    });
  });

  describe("purgeBackup", () => {
    it("deletes the backup for good", async () => {
      await seedLobby("court-a");
      await backupLobby(dir, "court-a", 1);
      await purgeBackup(dir, "court-a");
      expect(await listBackups(dir)).toEqual([]);
      await expect(restoreLobby(dir, "court-a")).rejects.toThrow(/no backup/);
    });

    it("refuses when there is nothing to purge", async () => {
      await expect(purgeBackup(dir, "ghost")).rejects.toThrow(/no backup/);
    });
  });
});
