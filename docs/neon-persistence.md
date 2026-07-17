# Neon: the game's permanent memory

## What Neon is

[Neon](https://neon.tech) is a hosted ("serverless") Postgres service. We
use its free tier as the game's database. From the code's point of view it
is just Postgres reached over a `postgresql://...` connection string - the
`pg` driver talks to it, nothing Neon-specific in the code beyond needing
TLS.

## The problem it solves

The game server runs on render.com's free tier, and that tier has an
**ephemeral disk**: whenever the service spins down after idle (which
happens many times a day) or redeploys, the container is thrown away and
the filesystem with it. Before Neon, worlds/profiles were JSON files on
that disk, so every spin-down was a lobby wipe - shared score gone, tiers
gone, wall history gone. That was the original "lobby keeps resetting"
bug.

Neon lives outside the container, so everything written to it survives
spin-downs, deploys, and crashes. Picked by the owner on 2026-07-17.

## What we store there

Four tables, created automatically on first boot (`CREATE TABLE IF NOT
EXISTS` in `server/pgStorage.ts`). Deliberately **not** a relational
schema - each table is a key -> JSONB document store, mirroring exactly
the JSON files we used before:

| Table        | Key                | Holds                                                        |
| ------------ | ------------------ | ------------------------------------------------------------ |
| `worlds`     | lobby id           | the world bundle: shared score, hoop tier, wall history, the AFK lineup (offline characters waiting to be reclaimed) |
| `profiles`   | player identity id | name, shirt color, rig cosmetics, per-lobby throw budgets    |
| `logs`       | (lobby, timestamp) | the forever archive: EVERY wall line ever, append-only       |
| `recordings` | (lobby, throw id)  | ghost replays (👀), so replays survive restarts too          |

`logs` is write-only at runtime - nothing reads it back; it exists so no
lobby event is ever lost. `recordings` payloads are the client's
`ThrowRecording`, stored opaquely.

## How it's wired in

The whole integration hinges on one interface, `Storage` in
`server/storage.ts`. It has two implementations:

- `JsonFileStorage` (`server/storage.ts`) - JSON files under `data/`.
- `PgStorage` (`server/pgStorage.ts`) - the four Neon tables above.

`server/index.ts` picks at boot:

```
DATABASE_URL set   -> PgStorage (production on render)
DATABASE_URL unset -> JsonFileStorage (local dev, unchanged)
```

So dev needs no database at all, and the rest of the server never knows
which backend it's on. The boot log says which one was chosen ("storage:
Postgres" vs "storage: JSON files").

Implementation notes:

- **TLS is required** by Neon; `PgStorage` passes `ssl: true`. Neon's
  endpoint presents a normal, verifiable cert chain, so no
  `rejectUnauthorized` escape hatch.
- **Small pool** (`max: 4`) - one game-server process, not a fleet, and
  Neon's free tier has a connection cap anyway.
- **Schema bootstrap is lazy**: the constructor kicks off the `CREATE
  TABLE` batch and every query awaits that one-time promise first.
- **Writes are upserts** (`ON CONFLICT ... DO UPDATE`), saved on every
  event rather than at "session end" - free-tier hosts suspend idle
  processes, so there is no reliable shutdown moment to save at.
- **Ids are sanitized** (`safe()` in storage.ts) before being used as
  keys; they come from the outside world.
- **No migrations in storage**: legacy document shapes (e.g. the old
  daily-budget fields) are stored and returned untouched; hydration code
  (`shared/budget.sanitizeBudget`) owns migration.

## Testing

`server/pgStorage.test.ts` is a **live contract test**: it runs the full
round-trip suite against a real database, but only when
`TEST_DATABASE_URL` is set - plain `npm test` and CI skip it.

```powershell
$env:TEST_DATABASE_URL = "postgresql://..."; npm test
```

It uses throwaway timestamped keys (`vitest-<stamp>`) so running it
against the live database leaves it clean-ish.

## Operations

- The connection string comes from the Neon dashboard (project ->
  Connect). It contains the password - it lives only in render's
  environment settings and your local shell, never in the repo.
- Set it as `DATABASE_URL` on the render service (see
  docs/deploy-render.md, env-var step). Removing it falls back to JSON
  files on the ephemeral disk - everything still works, data just dies
  with the container again.
- Neon's free tier auto-suspends the database when idle; the first query
  after a suspend takes a moment longer while it wakes. For this game's
  traffic that is invisible.
