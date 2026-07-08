# Multiplayer — Reference & Working Doc

> **Status (2026-07-09):** Stage 1 (modularity refactor) AND Stage 2
> (multiplayer, build steps 2–7) DONE. Two-browser verified at every step:
> presence + cross-client walking, server-authoritative throws/scoring,
> snapshots, persistence across room teardown, chat/bubbles, and the
> server-side daily budget (survives reconnect). Single-player unchanged
> through `LocalBackend` (re-verified). 38 unit tests. `npm run server` +
> `npm run dev`, then two windows at `?lobby=<id>` — see README.
> Not yet done: Render/Postgres deploy, bot integration, hoop tiers 2+.

> Read this fully before writing multiplayer code. It is **both the spec and a
> live working doc**: as you build, **update it** — replace each `DECIDE:` with
> the choice made, check off implemented pieces, and correct anything that turns
> out wrong. Hand it back updated.
>
> **Starting point:** a single-player gameplay prototype (movement, aim, throw,
> camera, score juice) that already feels good. **Do not regress that feel.**
> Multiplayer is layered on top; the local experience must survive intact as one
> of two backends (see Backend seam).

---

## Scope of this pass

**In:** two-plus players sharing a persistent world, seeing each other move and
throw in real time; server-authoritative scoring and throw budget; shared world
progression synced to all; presence (join/leave); chat relayed to the log;
persistence so a world survives restarts and players can return.

**Out (leave modular hooks, don't build yet):** the Telegram/Discord bots
themselves; soft currency / amenity purchases; amenity-object interaction beyond
showing presence; any matchmaking.

---

## Core architecture — SETTLED (do not relitigate)

Simple by design, because the game is **delay-tolerant** — nothing needs
millisecond fairness.

- **Broadcast intents, not positions.** Point-and-click movement means the
  meaningful data is *where a character was told to go*, not its per-frame
  position — send one `move-to` event; every client animates locally
  (RuneScape / Diablo / LoL model).
- **Deterministic shared computation.** Throw arcs *and* scoring are computed by
  the **same function on client and server**, so every client draws an identical
  ball flight from the launch parameters. Nobody streams the ball.
- **Server is authoritative over outcomes.** Clients render what the server
  confirms; they never decide gameplay outcomes.
- **Delay-tolerant.** Because clients animate *known paths*, a late message just
  appears a fraction behind — smooth, no jitter/rubber-banding.
- **Events relay immediately** — no turn metronome.

### What we are deliberately NOT building

No client-side prediction, rollback, interpolation of streamed positions, lag
compensation, or clock-sync. The point-and-click + intent-broadcast model
dissolves the problem those solve. They belong to competitive twitch games; this
isn't one.

### Patterns worth reusing (from the sibling project's netcode)

- **Server-authoritative, "never trust the client."** Validate every
  gameplay-affecting event server-side.
- **Shared pure functions.** Rules + deterministic computation (throw physics,
  scoring) live in a dependency-free `src/shared/` module imported by **both**
  server and client, so rendered result == authoritative result.
- **Swappable network seam.** Rendering/input sit above a `Backend` interface, so
  a live-socket backend and a local/offline backend share ~all code.
- **Bots through the human interface.** AI players (if any) go through the same
  action path as humans (a bot is just a participant with a null socket).
- **"The loop must never stop."** Guard the server loop so one bad event degrades
  to a skip and re-arms, never freezing a world.
- **Full-ish snapshots for self-healing.** Periodically broadcast whole world
  state so a client that drops a packet or joins late self-heals from the newest
  snapshot. Live world state (a few positions + a ball) is tiny, so this is cheap.

**DROP from that project:** its ~3-second turn metronome. This game relays events
immediately.

---

## Identity & lobbies — UPDATED (supersedes the old "curated set + server-side config")

Lobbies are **not pre-declared.** A lobby is created **on demand** and keyed by
the **invite link** a bot drops into a chat — in practice the lobby ID derives
from the originating chat (Telegram group / Discord channel) ID. Clicking the
link opens the game with `?lobby=<id>` and joins that world.

Player **identity comes from the bot platform** (Telegram/Discord user ID),
passed through the invite link — so there is **no auth to build**. A profile is
keyed to that identity and is **persistent**: individual ball progression,
cosmetic (shirt colour), and daily throw budget travel with the player across
worlds.

- One chat = one lobby = one persistent world.
- The **game server and the bots are separate processes that share the
  database** (profiles, lobby↔chat mapping, scores). Bot = invites + notifications;
  game server = live play. Keep them decoupled.
- **DECIDED: max 8 players per lobby** (`BALANCE.lobby.maxPlayers`); overflow is
  **rejected** with a friendly "court is full" notice (queue/spectate deferred —
  they need UI that doesn't exist yet, and 8 concurrent players per chat group
  is already generous for a hangout).
- *Dev interim:* until the bots exist, identity is `?pid=` (or a per-browser
  localStorage id) and the display name comes from the existing name overlay.
  The bot platform id/name slots straight into `join.identity`.

---

## Presence vs. persistence — NEW (important)

- **Presence** (who is connected now, whose avatar is visible) is **ephemeral.**
  On disconnect: remove the avatar, broadcast a leave, log it.
- **Membership / progress** (the player's profile and the world's shared progress)
  is **persistent.** A player returns to the *same* world and continues — this is
  a persistent hangout, not a disposable match.
- On reconnect: re-add the avatar and re-sync the player from the latest world
  snapshot. No dedicated "reconnection protocol" — **the snapshot is the recovery
  mechanism.**

---

## Syncing — field-level

Rule of thumb: **intents and outcomes are synced; derived and in-progress state
is local.**

**Synced (broadcast to everyone in the world):**

- **Movement intent** — `move-to(playerId, destination, startTime)`; position is
  derived locally, never streamed per-frame.
- **Throw events** — `throw(playerId, origin, angle, power, time)`; the arc is
  recomputed identically by every client via the shared function.
- **Outcomes** — server-decided: made/missed, points scored, and any resulting
  **shared progression change** (cumulative score, hoop-tier unlock).
- **Shared world state** — current hoop tier, cumulative shared score, unlocked
  amenities / visual chapter. Part of the snapshot.
- **Presence** — join / leave / idle.
- **Chat** — relayed to the log ("wall").
- **Character appearance** — shirt colour etc., sent on join.

**Not synced (local only):**

- **Per-frame position** — derived from `move-to`.
- **Aim-in-progress** — the live drag is local/cosmetic. **DECIDED: not
  telegraphed** this pass — it's pure polish, costs a per-frame-ish message
  class we otherwise don't have, and nothing depends on it. Revisit later.
- **UI / camera / cursor / previews.**
- **A player's private ball inventory and remaining throw budget** — persisted
  per-player; only the *effects* (a throw, a score) are broadcast.

---

## Server authority — throws, budget, scoring

- **Throw budget: 5 throws per player per day.** Server-authoritative — the client
  may *display* the remaining count, but the server owns it and rejects
  over-budget throws. Never trust the client for "throws left" or "I scored."
- **Scoring lives in the shared deterministic module** so predicted arc == server
  result. Current rule (distance = floor metres from shot spot to hoop):
  - inside the 3-pt line: **100**
  - at the 3-pt line: **250**
  - beyond: **250 + 10 per metre past the line**, capped at **500**
- **Throw resolution:** client sends launch params → server validates budget +
  state → server computes outcome via the shared fn → server decrements budget,
  updates shared score/tier → broadcasts outcome + new snapshot. The server does
  **not** stream the ball; it resolves the outcome and clients animate the known
  arc.
- **DECIDED: the budget resets at UTC MIDNIGHT** (`server/budget.ts`, unit
  tested). Simple, identical for every world, explainable in five words.
  Rolling-24h rejected (opaque to players); per-world local time rejected (no
  timezone source until the bot platform provides one).

---

## Shared progression — hoop tiers (build data-driven)

Shared per-world progression: cumulative community score unlocks a ladder of
hoops, each a **different challenge** (not merely "worth more") and each
**transforming the world** (visual chapter + amenity). This must be
**data-driven** — a tier is a data entry, so adding Hoops 2–6 later is a content
change, not a code change.

What the code must support without rework:

- A hoop tier defined as data, roughly
  `{ threshold, hoopBehaviour, visualChapter, amenity }`.
- Hoop **behaviours pluggable** (static / double / moving / walking …) behind a
  common interface — the throw/scoring code must not care which is active.
- Cumulative shared score is part of synced world state; crossing a threshold
  fires a **tier-unlock event** broadcast to everyone.
- `DECIDE:` (design, later, not this pass) whether shared progress counts *makes*
  or *attempts*; the contribution floor so a 0/5 day still nudges the bar; the
  endgame at the top of the ladder.

---

## Persistence — the hard part (expanded)

Two things persist, **separately**:

1. **World bundle** (per lobby): shared score, current hoop tier, unlocked
   amenities / chapter, and the event log / history. Self-contained + serializable.
2. **Player profile** (per identity): individual ball progression, shirt colour,
   daily throw budget + last-reset timestamp. Travels across worlds.

- Persist **on event**, not at a "session end" that never comes — Render's free
  tier suspends after ~15 min idle and in-memory-only state evaporates.
- **Load world** = hydrate the bundle from Postgres. **Save** = write on any
  meaningful change.
- **Idle world** (no one connected) = tear down the live room; state safe in
  Postgres; rehydrate on next join.

---

## Modularity review (do this to the prototype FIRST, before sockets)

This is what makes both the multiplayer layer and the hoop progression drop in
cleanly:

- [x] **Backend seam.** `src/backend/types.ts` (interface + typed events) and
  `src/backend/local.ts` (`LocalBackend`). `CourtScene` sends intents
  (`moveTo` / `requestThrow` / `chat`) and renders events (`welcome` /
  `throwStarted` / `outcome` / `chatMessage` / presence); it never touches a
  transport. `main.ts` constructs the backend and injects it.
- [x] **Shared deterministic module** — `src/shared/` (no DOM/Phaser/Node):
  `physics.ts` (the substepped stepper), `scoring.ts`, `court.ts` (landmarks/
  clamps in meters), `simulate.ts` (`resolveThrow(launch)` — the server-side
  authority; fixed internal dt so one launch = one authoritative outcome),
  `config.ts`, `tiers.ts`, `balls.ts`, `messages.ts`. Unit tests cover the
  stepper AND the resolver (34 tests, `npm test`).
- [x] **Typed message vocabulary** — `src/shared/messages.ts`: `ClientMsg` /
  `ServerMsg` unions plus the shared shapes (`PlayerInfo`, `WorldState`,
  `ThrowLaunch`, `ThrowOutcome`). The Backend event surface uses the same
  shapes, so client and (future) server compile against one vocabulary.
- [x] **Data-driven definitions** — `shared/tiers.ts` (`HoopTierDef
  { threshold, hoopBehaviour, visualChapter, amenity }` + `tierForScore`;
  tier 1 = today's static hoop, behaviours are a pluggable id), `shared/
  balls.ts` (`BallTypeDef`; one "standard" entry today — threading per-throw
  ball types through physics is deferred to ball progression), and
  `shared/config.ts` (`BALANCE`) as the single balance surface: court, hoop,
  throw physics, power curve, scoring (incl. slam points), walls, movement,
  ground, **throw budget**. Client-only feel knobs stay in `src/tuning.ts`,
  which spreads `BALANCE` so `T.*` keeps working.
- [ ] **Storage interface** — deferred to Stage 2 step 5 (persistence); it's a
  server concern and there's no server yet.

After the refactor the prototype must still play **identically** through
`LocalBackend`. ✅ Verified: 13-point browser parity sweep (throw/score/miss,
chat+bubble, walk, teleport slam, ghost replays) all green.

### Stage-1 implementation notes (conventions the next steps rely on)

- **Local authority quirk, by design:** in `LocalBackend` the *client's live
  ball* decides the outcome (`Backend.reportOutcome`) — that's the exact
  prototype feel, preserved. `SocketBackend` will IGNORE client reports; the
  server resolves via `resolveThrow` and the outcome arrives as an event. The
  seam keeps scene code identical in both worlds.
- `resolveThrow` uses a fixed internal dt (1/120). This does NOT contradict
  the owner's "live physics stays non-deterministic" decision: live balls
  still animate on variable frame time; the fixed step only guarantees one
  launch → one authoritative result. Knife-edge rattles may rarely resolve
  differently client vs. server — the server's outcome wins (Stage 2 will
  surface how this feels; flagged for review).
- Throws carry a client-generated `throwId` for correlating
  `requestThrow` → `throwStarted` → `outcome` (and ghost recordings).
- `ThrowLaunch` includes `shotX/shotD` (where the shooter stood) because the
  points table is keyed to the *shot spot*, not the release point. It also
  carries `slam` — the server will need to validate slam legitimacy
  server-side when the orb moves server-side (currently the orb power-up is
  client-local; flagged as a Stage-2+ follow-up).
- The throw **budget constant** lives in `BALANCE.budget.throwsPerDay`;
  `LocalBackend` deliberately does NOT enforce it (single-player practice is
  unlimited) — enforcement is the server's job (build step 7).

---

## Tech stack

- **Client:** Phaser (`pixelArt` rendering).
- **Server:** a single Node server with WebSockets — built with plain `ws`
  (lighter than Socket.IO; `shared/messages.ts` is the protocol). One world =
  one room; events broadcast to that room. Run via `tsx` (`npm run server`).
- **Hosting (initial):** Render.com — reachable by a plain browser link.
  *(Not deployed yet — next infrastructure task.)*
- **Persistence:** Postgres (on Render). *Interim:* `JsonFileStorage` behind
  the same `Storage` interface for local dev; the Postgres implementation is a
  drop-in when deploying.
- **Scaling path (later, only if needed):** Cloudflare Durable Objects — one
  object per world, native hibernation. Building each world's state as a clean
  serializable bundle keeps this migration close to one-to-one.

---

## Build order (suggested — keep each step playable, commit per step)

1. ✅ **Refactor** prototype behind the Backend seam; move throw + scoring into
   `src/shared/`; extract balance/data. No behaviour change — still plays
   identically via `LocalBackend`. *(Done — see Stage-1 notes above.)*
2. ✅ **Server + presence:** Node + `ws` (`npm run server`, port 8787); one Room
   per `?lobby=` id, created on demand, torn down when empty; presence +
   `move-to` intents (clamped server-side, relayed to others); two browsers see
   each other walk. Client: `SocketBackend` + `RemoteAvatar` (per-shirt-colour
   textures, Player-identical walk feel).
3. ✅ **Throws:** launch validated (never trust the client), relayed to the
   others; the thrower spawns **optimistically** for zero-latency feel; outcome
   resolved immediately via `resolveThrow` but **broadcast on a timer at
   `resolvedAtS`** so score juice lands when the ball visually lands.
4. ✅ **Shared state:** score + tier update atomically per outcome; full
   snapshot broadcast every 5s (the snapshot IS the recovery mechanism);
   tier-unlock event wired (fires once tiers 2+ exist as data).
5. ✅ **Persistence:** `server/storage.ts` — `Storage` interface (the
   Postgres/DO swap point) with `JsonFileStorage` for local dev (`data/`,
   gitignored). World bundle (score, tier, last 50 wall lines) + player profile
   (name, shirt, budget), saved on event, hydrated before joins; welcome
   replays the wall history to late joiners.
6. ✅ **Social:** chat broadcast to everyone (one client render path) +
   persisted to the wall; join/leave lines; speech bubbles over remote
   avatars too.
7. ✅ **Budget:** `server/budget.ts` (pure, unit-tested), consumed at throw
   acceptance, persisted in the profile (survives reconnect — verified), UTC
   midnight reset; ball slots double as the remaining-throws display; local
   play stays unlimited.

---

## Open decisions to surface (don't silently pick — default, implement, flag)

- ✅ DECIDED: **max 8 players / lobby, overflow rejected** (see Identity & lobbies).
- ✅ DECIDED: **budget resets at UTC midnight** (see Server authority).
- ✅ DECIDED: **aim-in-progress NOT telegraphed** this pass (see Syncing).
- `DECIDE:` (design, later) shared progress counts makes vs. attempts; contribution
  floor; top-of-ladder endgame.

## Stage-2 implementation notes & known follow-ups

- **Optimistic own-throw spawn:** the thrower's ball appears instantly (the
  prototype feel); the server relays to others and owns the outcome. If the
  server rejects (budget/invalid), the flight was cosmetic — a rejection notice
  follows and no score can result. Flagged as intended behaviour.
- **Client visuals vs. server truth:** every client animates its own live ball
  (variable frame time, by design); the server's fixed-dt `resolveThrow` decides.
  Knife-edge rim rattles can rarely LOOK different from the ruling. Watch for it
  in playtests; the fix (animating the server's sampled arc) is available if it
  ever grates.
- **The teleport orb is still client-local.** A slam flag rides on the launch
  and the server pays `slamPts` for it without being able to validate the
  levitation. Fine among friends; the orb must move server-side (spawn + hit
  detection in the Room) before strangers share worlds. **Top follow-up.**
- **Ghost records are recorded only for your own throws** — remote outcome log
  lines are not clickable. Replaying others' throws would need remote-avatar
  history capture; deferred (the sample format already supports it).
- **Not built yet:** Render deploy + Postgres `Storage` impl, bot processes,
  hoop tiers 2+ (pure data + behaviour implementations), amenities.
