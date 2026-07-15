import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { safe } from "./storage";
import type { WorldBundle, ArchivedEntry } from "./storage";

// Admin file operations behind `npm run admin` (scripts/admin.ts).
// Pure functions over a data dir - the CLI is a thin arg-parsing shell,
// and these are unit-tested the same way storage is (mkdtemp).
//
// "Removing" a lobby is a move, never a delete: worlds/<lobby>.json and
// logs/<lobby>.jsonl go to backups/<lobby>/ so a restore is just the
// reverse move. Profiles are global (shared across lobbies) and are
// never touched. Only purgeBackup() actually deletes anything.

export interface LobbySummary {
  lobby: string;
  /** distinct player names that ever joined (from the log archive) */
  players: number;
  tierId: number;
  /** epoch ms of the last logged event; 0 if nothing is known */
  lastVisited: number;
}

export interface BackupSummary {
  lobby: string;
  removedAt: number; // epoch ms
}

const worldPath = (dir: string, lobby: string) =>
  join(dir, "worlds", `${safe(lobby)}.json`);
const logPath = (dir: string, lobby: string) =>
  join(dir, "logs", `${safe(lobby)}.jsonl`);
const backupDir = (dir: string, lobby: string) =>
  join(dir, "backups", safe(lobby));

export async function listLobbies(dataDir: string): Promise<LobbySummary[]> {
  const files = await readdir(join(dataDir, "worlds")).catch(() => []);
  const out: LobbySummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const lobby = f.slice(0, -".json".length);
    const bundle = await readJson<WorldBundle>(join(dataDir, "worlds", f));
    const entries = await readLog(logPath(dataDir, lobby));
    const names = new Set(
      entries.flatMap((e) =>
        e.kind === "presence" && e.joined ? [e.name] : [],
      ),
    );
    // last visited = the last logged player-caused event; the file's
    // mtime is only a fallback (moves and git churn rewrite it)
    let lastVisited = entries.length ? entries[entries.length - 1].at : 0;
    if (!lastVisited)
      lastVisited = await stat(join(dataDir, "worlds", f))
        .then((s) => s.mtimeMs)
        .catch(() => 0);
    out.push({
      lobby,
      players: names.size,
      tierId: bundle?.world.tierId ?? 1,
      lastVisited,
    });
  }
  return out.sort((a, b) => b.lastVisited - a.lastVisited);
}

/** Move a lobby's files to data/backups/<lobby>/ - the "remove" step. */
export async function backupLobby(
  dataDir: string,
  lobby: string,
  removedAt: number,
): Promise<void> {
  const dest = backupDir(dataDir, lobby);
  if (await exists(dest))
    throw new Error(
      `a backup for "${lobby}" already exists - restore or purge it first`,
    );
  if (!(await exists(worldPath(dataDir, lobby))))
    throw new Error(`no such lobby: "${lobby}"`);
  await mkdir(dest, { recursive: true });
  await rename(worldPath(dataDir, lobby), join(dest, "world.json"));
  if (await exists(logPath(dataDir, lobby)))
    await rename(logPath(dataDir, lobby), join(dest, "log.jsonl"));
  await writeFile(
    join(dest, "meta.json"),
    JSON.stringify({ lobby: safe(lobby), removedAt }, null, 2),
    "utf8",
  );
}

/**
 * The reverse move: full progress back (profiles were never touched).
 * If the old link was reopened meanwhile, a FRESH lobby with the same id
 * exists - refuse, unless `force`, which discards the fresh one (the CLI
 * kicks its players first so no live socket re-saves the dropped files).
 */
export async function restoreLobby(
  dataDir: string,
  lobby: string,
  force = false,
): Promise<void> {
  const src = backupDir(dataDir, lobby);
  if (!(await exists(src))) throw new Error(`no backup for "${lobby}"`);
  if (await exists(worldPath(dataDir, lobby))) {
    if (!force)
      throw new Error(
        `lobby "${lobby}" already exists (someone re-created it via the ` +
          `old link?) - restore with --force to discard it and bring the ` +
          `backup back`,
      );
    await rm(worldPath(dataDir, lobby), { force: true });
    await rm(logPath(dataDir, lobby), { force: true });
  }
  await mkdir(join(dataDir, "worlds"), { recursive: true });
  await rename(join(src, "world.json"), worldPath(dataDir, lobby));
  if (await exists(join(src, "log.jsonl"))) {
    await mkdir(join(dataDir, "logs"), { recursive: true });
    await rename(join(src, "log.jsonl"), logPath(dataDir, lobby));
  }
  await rm(src, { recursive: true, force: true });
}

export async function listBackups(dataDir: string): Promise<BackupSummary[]> {
  const dirs = await readdir(join(dataDir, "backups")).catch(() => []);
  const out: BackupSummary[] = [];
  for (const lobby of dirs) {
    const meta = await readJson<BackupSummary>(
      join(dataDir, "backups", lobby, "meta.json"),
    );
    out.push({ lobby, removedAt: meta?.removedAt ?? 0 });
  }
  return out.sort((a, b) => b.removedAt - a.removedAt);
}

/** The only true delete in the admin toolset. */
export async function purgeBackup(
  dataDir: string,
  lobby: string,
): Promise<void> {
  const dir = backupDir(dataDir, lobby);
  if (!(await exists(dir))) throw new Error(`no backup for "${lobby}"`);
  await rm(dir, { recursive: true, force: true });
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readLog(path: string): Promise<ArchivedEntry[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ArchivedEntry);
  } catch {
    return [];
  }
}
