import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  HistoryEntry,
  PlayerInfo,
  WorldState,
} from "../src/shared/messages";
import type { BudgetFields } from "../src/shared/budget";

// Persistence - three things persist, SEPARATELY:
//   1. the world bundle (per lobby): shared score, tier, wall history
//   2. the player profile (per identity): appearance, daily throw budget
//   3. the log archive (per lobby): EVERY wall line ever, append-only
// Bundles/profiles are saved ON EVENT (free-tier hosts suspend idle
// processes; there is no "session end" to save at) and hydrated on join.
// The archive is write-only from the server's point of view - nothing
// reads it back at runtime; it exists so no lobby event is ever lost.
//
// The Storage interface is the swap point: JsonFileStorage now (local
// dev), Postgres on Render next, Durable Objects later - one place.

export interface WorldBundle {
  lobby: string;
  world: WorldState;
  history: HistoryEntry[];
  /** the AFK lineup (owner ask 2026-07-18): disconnected characters
   *  ride the bundle so a server restart or room teardown re-seats
   *  them instead of an empty court - their players reclaim them on
   *  rejoin. Optional so pre-lineup bundles hydrate cleanly. */
  offline?: OfflineCharacter[];
}

/** One waiting character as persisted with the world. */
export type OfflineCharacter = PlayerInfo & {
  /** epoch ms of the disconnect - hydrate prunes the too-old */
  offlineSinceMs: number;
};

export interface PlayerProfile {
  id: string;
  name: string;
  shirtColor: number;
  /** rig cosmetics - optional so pre-rig profiles hydrate cleanly */
  skinTint?: number;
  lowerTint?: number;
  headVariant?: number;
  /**
   * Daily throw budgets, PER LOBBY (keyed by lobby id) - a fresh court
   * hands out a fresh set of balls; what you spent elsewhere stays
   * there. Optional so profiles from the per-identity-budget era (fields
   * `throwsUsedToday`/`lastThrowDayUTC`, now ignored) hydrate cleanly.
   */
  budgets?: Record<string, BudgetFields>;
}

/** One line of the permanent per-lobby log archive. */
export type ArchivedEntry = HistoryEntry & { at: number }; // epoch ms

export interface Storage {
  loadWorld(lobby: string): Promise<WorldBundle | null>;
  saveWorld(bundle: WorldBundle): Promise<void>;
  loadProfile(id: string): Promise<PlayerProfile | null>;
  saveProfile(profile: PlayerProfile): Promise<void>;
  /** Append to the lobby's permanent log - every entry, kept forever. */
  appendLog(lobby: string, entry: ArchivedEntry): Promise<void>;
  /** Ghost recordings, keyed per lobby + throwId (owner 2026-07-17:
   *  replays survive restarts too). The payload is the client's
   *  ThrowRecording - the server stores it opaquely. */
  saveRecording(lobby: string, throwId: string, rec: unknown): Promise<void>;
  loadRecording(lobby: string, throwId: string): Promise<unknown | null>;
}

/** ids come from the outside world - never let them escape the data dir */
export function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

export class JsonFileStorage implements Storage {
  constructor(private readonly dir = "data") {}

  async loadWorld(lobby: string): Promise<WorldBundle | null> {
    return this.read(join(this.dir, "worlds", `${safe(lobby)}.json`));
  }

  async saveWorld(bundle: WorldBundle): Promise<void> {
    await this.write(
      join(this.dir, "worlds", `${safe(bundle.lobby)}.json`),
      bundle,
    );
  }

  async loadProfile(id: string): Promise<PlayerProfile | null> {
    return this.read(join(this.dir, "profiles", `${safe(id)}.json`));
  }

  async saveProfile(profile: PlayerProfile): Promise<void> {
    await this.write(
      join(this.dir, "profiles", `${safe(profile.id)}.json`),
      profile,
    );
  }

  // JSONL, one entry per line: append is atomic enough for a single
  // process and the file never needs rewriting, however large it grows
  async appendLog(lobby: string, entry: ArchivedEntry): Promise<void> {
    const path = join(this.dir, "logs", `${safe(lobby)}.jsonl`);
    await mkdir(join(path, ".."), { recursive: true });
    await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
  }

  async saveRecording(lobby: string, throwId: string, rec: unknown) {
    await this.write(
      join(this.dir, "recordings", safe(lobby), `${safe(throwId)}.json`),
      rec,
    );
  }

  async loadRecording(lobby: string, throwId: string): Promise<unknown | null> {
    return this.read(
      join(this.dir, "recordings", safe(lobby), `${safe(throwId)}.json`),
    );
  }

  private async read<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch {
      return null; // missing or corrupt → fresh start
    }
  }

  private async write(path: string, value: unknown): Promise<void> {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 2), "utf8");
  }
}
