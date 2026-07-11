# Multiplayer — Reference & Working Doc

> **Status (2026-07-09):** Stage 1 (modularity refactor) AND Stage 2
> (multiplayer, build steps 2–7) DONE, **plus step 8: the teleport orb is
> now a server-authoritative world object** (spawn/expiry/consumption in the
> Room, hit ruled by the shared resolver, slam flag validated server-side —
> see "Server-authoritative world objects" below). Two-browser verified at
> every step: presence + cross-client walking, server-authoritative
> throws/scoring, snapshots, persistence across room teardown, chat/bubbles,
> the server-side daily budget (survives reconnect), and synced orb +
> cross-client teleports. Out-of-budget throws are now blocked client-side
> too (no phantom local balls others can't see). Single-player unchanged
> through `LocalBackend` (re-verified). 45 unit tests. `npm run server` +
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
keyed to that identity and is **persistent**: individual ball progression and
the daily throw budget travel with the player across worlds.

**UPDATED (2026-07-09, owner decision): name + shirt colour are PER-LOBBY,
not global.** The first time a player enters a lobby they're asked for a
name and a colour is rolled; from then on that lobby — and only that lobby —
always shows them that way. Stored client-side per lobby
(`shootDaHoop.name.<lobby>` / `shootDaHoop.shirt.<lobby>`; consistent with
the dev-interim per-browser `pid`). Offline play keeps the original
browser-global name/colour. The server profile still mirrors the
last-joined name/shirt but nothing reads it back.

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
- **Character appearance** — full cosmetics on join: shirt colour (hard
  tint), skin tint (shared by head + hands), trouser tint, head variant.
- **Pose telemetry** — `pose` messages, ~12 Hz while animating with a
  0.4 s keep-alive for held poses: the full `AvatarState` (position,
  airH, facing, figure rotation, pose kind + clocks + **live aim
  angle/power**). Receivers render ~150 ms in the past, lerping between
  the straddling samples (`sampleAt`/`lerpFrame` — the ghost interp,
  reused), so remote motion is smooth at any send rate. Stale stream
  (> 0.7 s) falls back to the original move-to intent walk.
- **The teleport orb** — a server-authoritative world object:
  `orb-spawned` / `orb-removed` / `teleported` events, current orb in
  welcome + snapshots. See the dedicated section below.

**Not synced (local only):**

- **Per-frame position** — `pose` telemetry when flowing, `move-to`
  intents as fallback; never per-frame.
- **UI / camera / cursor / previews** — the aim *preview line* stays
  local; opponents read aim from the character's pose instead.
- **A player's private ball inventory and remaining throw budget** — persisted
  per-player; only the *effects* (a throw, a score) are broadcast.

---

## Server authority — throws, budget, scoring

- **Throw budget: 5 throws per player per day.** Server-authoritative — the client
  may *display* the remaining count, but the server owns it and rejects
  over-budget throws. Never trust the client for "throws left" or "I scored."
  (Offline the LocalBackend self-enforces the same rule — see below; that's a
  practice-mode nicety, not an authority statement.)
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
- **DECIDED: the budget resets at UTC MIDNIGHT** (`src/shared/budget.ts`, unit
  tested). Simple, identical for every world, explainable in five words.
  Rolling-24h rejected (opaque to players); per-world local time rejected (no
  timezone source until the bot platform provides one).
- **Shared-score reset (owner tool, 2026-07-09):** joining with `&reset=1`
  in the link wipes the world's shared score + tier (budgets and the wall
  history are kept), persists the wipe, broadcasts `world-reset` to everyone
  connected, and records a `reset` wall line crediting the resetter. The
  client strips the param from the address bar after use so refreshes don't
  re-wipe. Anyone with the link can reset — fine among friends; gate it on
  the bot-platform admin role when the bots land.

---

## Server-authoritative world objects — the pattern (added 2026-07-09)

Some things exist in the WORLD, not on any client: the server decides when
they appear, disappear, and who they affect; clients only render what
they're told. The shared score/tier (`WorldState`) was already one such
object; the **teleport orb** is now the second. The pattern, for anything
future (amenities, moving hoops, pickups):

1. **State shape + pure rules in `src/shared/`** — `shared/orb.ts` has
   `OrbState {seq,x,d,h}`, `rollOrbSpawn` and `orbHitTest`; the gameplay
   knobs sit in `BALANCE.orb`. `seq` increments per world so removal /
   snapshot races dedupe cleanly.
2. **Lifecycle in a server module** — `server/orb.ts` (`OrbAuthority`)
   owns the spawn/expire/respawn clock; the Room broadcasts the events and
   includes the current state in `welcome` and every snapshot (self-heal).
3. **Decisions via the shared resolver** — a throw is ruled against the
   live orb inside `resolveThrow(launch, orb)` (same fixed-dt arc as
   scoring). On a ruled hit the Room waits until the ball visually arrives,
   re-checks the orb still exists (`consume(seq)` — expiry or another ball
   may have won), then broadcasts `orb-removed {seq, byId}` +
   `teleported {id, throwId, to}`; if the orb is gone, the throw falls
   back to its plain-arc outcome. The teleported player's
   `levitatingUntil` is stamped so the follow-up slam flag can be
   **validated, not trusted**.
4. **Rendering is dumb** — client `TeleportOrb` (`src/powerup.ts`) only
   draws told state. The local player's OWN balls still hit-test locally
   for the zero-latency zap (optimistic, deduped by seq when the ruling
   arrives); remote balls never trigger local teleports — remote teleports
   arrive as events and replay the zap/levitate/fall arc on the
   `RemoteAvatar`.
5. **`LocalBackend` is the offline authority** — same lifecycle, same
   shared rules, in-process; single-player feel is unchanged and the
   client's live-ball hit report is trusted there (`Backend.reportOrbHit`,
   a no-op on `SocketBackend`).

Known accepted edges (fine among friends, revisit for strangers):
- Both players' balls converging on one orb inside the same ~200ms window:
  each may zap optimistically; the server confirms exactly one — the
  loser's slam flag is invalidated so no illegitimate 500 can result.
- A client-side optimistic hit whose fixed-dt ruling narrowly disagrees
  leaves that client orb-less until the next spawn (cosmetic only).
- ✅ DECIDED (2026-07-10): **the orb-hit throw is REFUNDED** when the server
  confirms the hit (the player "keeps the ball"; the slam is a free throw) —
  `refundThrow` in `src/shared/budget.ts`, corrected count pushed to the thrower.

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
  carries `slam` — ✅ now VALIDATED server-side (the Room only honors it
  within `levitatingUntil` after its own teleport ruling; step 8).
- The throw **budget constant** lives in `BALANCE.budget.throwsPerDay`;
  the helpers are shared (`src/shared/budget.ts`). Online the server enforces
  it against the persisted profile (build step 7); offline `LocalBackend`
  enforces the same rule against a localStorage counter (`shootDaHoop.budget`)
  — originally single-player practice was unlimited, but 5 always-lit ball
  slots read as a bug, so the budget now applies everywhere (2026-07-12).

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
2. ✅ **Server + presence:** Node + `ws` (`npm run server`, port 9999); one Room
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
7. ✅ **Budget:** `src/shared/budget.ts` (pure, unit-tested; moved from
   `server/` when offline enforcement landed), consumed at throw acceptance,
   persisted in the profile (survives reconnect — verified), UTC midnight
   reset; ball slots double as the remaining-throws display; LocalBackend
   enforces the same budget offline via localStorage (2026-07-12).
8. ✅ **Server-side orb:** the teleport orb became a server-authoritative
   world object (see the pattern section above); slam flags validated;
   out-of-budget throws blocked client-side so nobody animates balls the
   world never saw; throwIds got a random suffix (cross-client uniqueness).
9. ✅ **Spawn + balance pass (2026-07-10):** joins spawn at a random spot in a
   100×100px square beside the keep-out zone (`rollSpawn` in
   `shared/court.ts`, rolled by the authority — the client positions its own
   Player from `welcome`, so all screens agree) with a dust-puff VFX on every
   client; keep-out zone −20% (`hoopStandoffM` 6.25→5.0); orb −35%
   (`orb.radiusM` 0.55→0.3575); orb-hit throws refunded (free slam).
10. ✅ **Wall filters + permanent log archive (2026-07-11):**
    - Client: the wall header grew a filter dropdown (▾) with two
      checkboxes, both ON by default and persisted in
      `shootDaHoop.logFilters`: **Ball misses** (throw lines carrying the
      `miss` class) and **Connection events** (the `presence` type — joins,
      leaves, disconnects, rejections, out-of-budget notices). Nothing else
      is filterable by design: chat, made shots, and the new `world` log
      type (score resets, tier unlocks — split out of `presence` so they
      can't be hidden) always show. Hiding is pure CSS
      (`#log-feed.hide-*` classes), so toggling applies retroactively to
      lines already on the wall and filtered lines keep accumulating
      underneath.
    - Server: `Storage.appendLog` writes **every** wall entry, stamped
      with `at` (epoch ms), to a per-lobby append-only archive
      (`data/logs/<lobby>.jsonl`) — kept forever, never trimmed. The
      in-memory/bundle wall stays capped at `lobby.historyKept` (50) for
      welcome replay; the archive is the unabridged record. Nothing reads
      it at runtime yet (future: bot admin tools, moderation, stats).
      Unit-tested in `server/storage.test.ts`.
11. ✅ **Parts-rig character + pose telemetry (2026-07-11):** the character
    is now composed from owner-drawn part PNGs (`public/assets/`: 3 heads,
    white t-shirt torso, trouser band, two hand circles — `guy.png` in git
    history is the assembly reference) instead of a single generated
    sprite.
    - **Tinting:** skin (head + both hands, one shared white→brown
      multiply tint), shirt (hard tint on the white torso — the per-colour
      texture cache is GONE, any colour works), trousers (subtle tint).
      Rolled per lobby beside name/shirt (`shootDaHoop.skin/lower/head.*`),
      carried in `PlayerInfo` + profile, server-sanitized.
    - **Pose model:** `shared/pose.ts` (pure, unit-tested) maps a
      `PoseState` (idle/walk/aim/throw/fall/lie/getup + clocks + aim) to
      per-part offsets; `characterRig.ts` is the Phaser container that
      tints once, mirrors `scaleX` for X-facing, and exp-smooths parts
      toward targets (kind changes ease, 12 Hz telemetry looks continuous).
      All limb motion is positional — tiny pixel art shears under rotation;
      only the whole-figure tilt/face-plant rotates.
    - **Animations:** walk = bob + antiphase hand swing + lean into
      travel; aim = ball held overhead, hold leans with the live aim and
      pulls back with power (slingshot read); throw = 250 ms follow-through
      sweep; fall/lie/getup = hands straight up (waggling in the fall) and
      they only come down once fully upright.
    - **Telemetry:** `pose` client msg → server sanitizes (`sanePose`) and
      relays; RemoteAvatar = interp buffer (render 150 ms back, ghost
      lerp helpers reused) with move-to fallback when stale; ghosts record
      the same `AvatarState` in `FrameSample` (yOff/flipX replaced by
      facing/pose). Two-tab verified: 81 relayed samples, remote showed
      the held ball + aim lean live.

---

## Open decisions to surface (don't silently pick — default, implement, flag)

- ✅ DECIDED: **max 8 players / lobby, overflow rejected** (see Identity & lobbies).
- ✅ DECIDED: **budget resets at UTC midnight** (see Server authority).
- ✅ DECIDED (REVERSED 2026-07-11): **aim-in-progress IS telegraphed** — the
  character rig rework streams full pose telemetry including the live aim
  angle/power, so opponents read the aim from the body (see Syncing). The
  original "not telegraphed" ruling stood from Stage 2 until the parts-rig
  landed.
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
- ✅ **The teleport orb moved server-side** (was the top follow-up): spawn +
  hit detection + slam validation live in the Room; see "Server-authoritative
  world objects" above. The old bugs — desynced per-client orbs, and a remote
  ball teleporting the WRONG (local) player — are fixed and two-browser
  verified.
- **Out-of-budget throws are gated client-side** (`CourtScene.sendThrow`):
  at 0 remaining the throw isn't sent and no optimistic ball spawns —
  previously the thrower saw phantom flights nobody else could see. A
  server rejection (e.g. a race) now also pops the optimistic ball.
- **Testing trick (no slow-mo feature needed):** automated tabs are
  `document.hidden`, so drive frames manually via
  `__court.game.loop.step(loop.now + 30)` — deterministic frame stepping —
  while WS events land in real time; attach listeners via
  `__court.backend.on(...)` to log the event streams on both clients and
  diff them.
- **Ghost records are recorded only for your own throws** — remote outcome log
  lines are not clickable. Replaying others' throws would need remote-avatar
  history capture; deferred (the sample format already supports it).
- **Not built yet:** Render deploy + Postgres `Storage` impl, bot processes,
  hoop tiers 2+ (pure data + behaviour implementations), amenities.
