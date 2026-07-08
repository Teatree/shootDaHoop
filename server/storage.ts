import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HistoryEntry, WorldState } from "../src/shared/messages";

// Persistence — two things persist, SEPARATELY:
//   1. the world bundle (per lobby): shared score, tier, wall history
//   2. the player profile (per identity): appearance, daily throw budget
// Both are saved ON EVENT (free-tier hosts suspend idle processes; there
// is no "session end" to save at) and hydrated on join.
//
// The Storage interface is the swap point: JsonFileStorage now (local
// dev), Postgres on Render next, Durable Objects later — one place.

export interface WorldBundle {
  lobby: string;
  world: WorldState;
  history: HistoryEntry[];
}

export interface PlayerProfile {
  id: string;
  name: string;
  shirtColor: number;
  /** daily throw budget — server-authoritative (build step 7) */
  throwsUsedToday: number;
  lastThrowDayUTC: string; // "YYYY-MM-DD"
}

export interface Storage {
  loadWorld(lobby: string): Promise<WorldBundle | null>;
  saveWorld(bundle: WorldBundle): Promise<void>;
  loadProfile(id: string): Promise<PlayerProfile | null>;
  saveProfile(profile: PlayerProfile): Promise<void>;
}

/** ids come from the outside world — never let them escape the data dir */
function safe(name: string): string {
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
