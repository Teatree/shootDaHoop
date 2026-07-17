import { Pool } from "pg";
import {
  safe,
  type ArchivedEntry,
  type PlayerProfile,
  type Storage,
  type WorldBundle,
} from "./storage";

// Postgres-backed Storage (Neon, owner pick 2026-07-17) - the durable
// fix for render's ephemeral free-tier disk: worlds, profiles, the
// forever archive and ghost recordings all survive spin-downs and
// deploys. Same document shapes as JsonFileStorage, stored as JSONB -
// four key-value-ish tables, no relational modelling on purpose (the
// Storage interface is the swap point; see storage.ts).
//
// Connection: DATABASE_URL (index.ts falls back to JSON files without
// it, so dev stays file-based). Neon needs TLS; a small pool suffices -
// this is a single game-server process, not a fleet.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS worlds (
    lobby TEXT PRIMARY KEY,
    data  JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS profiles (
    id   TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS logs (
    lobby TEXT NOT NULL,
    at    BIGINT NOT NULL,
    data  JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS logs_lobby_at ON logs (lobby, at);
  CREATE TABLE IF NOT EXISTS recordings (
    lobby    TEXT NOT NULL,
    throw_id TEXT NOT NULL,
    data     JSONB NOT NULL,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lobby, throw_id)
  );
`;

export class PgStorage implements Storage {
  private readonly pool: Pool;
  /** every query awaits the one-time schema bootstrap */
  private readonly ready: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 4,
      // Neon requires TLS; its endpoint presents a chain the default
      // verifier accepts, so no rejectUnauthorized escape hatch needed
      ssl: true,
    });
    this.ready = this.pool.query(SCHEMA).then(() => undefined);
  }

  async loadWorld(lobby: string): Promise<WorldBundle | null> {
    await this.ready;
    const r = await this.pool.query(
      "SELECT data FROM worlds WHERE lobby = $1",
      [safe(lobby)],
    );
    return (r.rows[0]?.data as WorldBundle) ?? null;
  }

  async saveWorld(bundle: WorldBundle): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO worlds (lobby, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (lobby) DO UPDATE SET data = $2, updated_at = now()`,
      [safe(bundle.lobby), bundle],
    );
  }

  async loadProfile(id: string): Promise<PlayerProfile | null> {
    await this.ready;
    const r = await this.pool.query(
      "SELECT data FROM profiles WHERE id = $1",
      [safe(id)],
    );
    return (r.rows[0]?.data as PlayerProfile) ?? null;
  }

  async saveProfile(profile: PlayerProfile): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO profiles (id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()`,
      [safe(profile.id), profile],
    );
  }

  async appendLog(lobby: string, entry: ArchivedEntry): Promise<void> {
    await this.ready;
    await this.pool.query(
      "INSERT INTO logs (lobby, at, data) VALUES ($1, $2, $3)",
      [safe(lobby), entry.at, entry],
    );
  }

  async saveRecording(lobby: string, throwId: string, rec: unknown) {
    await this.ready;
    await this.pool.query(
      `INSERT INTO recordings (lobby, throw_id, data, saved_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (lobby, throw_id) DO UPDATE SET data = $3, saved_at = now()`,
      [safe(lobby), safe(throwId), JSON.stringify(rec)],
    );
  }

  async loadRecording(lobby: string, throwId: string): Promise<unknown | null> {
    await this.ready;
    const r = await this.pool.query(
      "SELECT data FROM recordings WHERE lobby = $1 AND throw_id = $2",
      [safe(lobby), safe(throwId)],
    );
    return r.rows[0]?.data ?? null;
  }

  /** Tests + graceful shutdown - the pool must not hold the process. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
