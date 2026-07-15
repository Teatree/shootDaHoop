# shootDaHoop - Gameplay Prototype: What We Built and What We Learned

This document records everything done to the gameplay feel prototype across the
build sessions of 2026-07-08/09: what each feature is, **how the game's owner
wanted it to work** (design intent, captured verbatim where it matters), and the
technical discoveries made along the way. Companion docs:
[teleport-orb.md](teleport-orb.md) (purple orb power-up, Hoop 3 only) and
[ghost-records.md](ghost-records.md) (clickable log replays).

---

## 1. Foundations

- **Stack:** Phaser 3 + Vite + TypeScript, pure-code rendering (every texture is
  generated with Graphics at boot; anything the user drops in `public/assets/`
  overrides the placeholder).
- **World model:** positions are `(x, d, h)` in **meters** - `x` along the court
  (0 = left baseline), `d` = depth across a 6m playable band, `h` = height.
  Scale: 32 px/m (`T.court.meterPx`, exported as `M`). `world.ts` owns the
  mapping (`toScreen`, `floorY`, `sortDepth`).
- **Physics:** hand-integrated in the shooting plane (no Arcade/Matter). Depth
  eases toward the rim's lane during flight so every shot "reads" on the hoop.
- **Tuning philosophy:** every feel knob lives in `src/tuning.ts` with comments.
  Vite HMR makes it a live mixing desk. New features must add their knobs there.
- **HUD:** DOM, not canvas - score, ball slots, chat, and the log panel are HTML/CSS
  over the game viewport.

---

## 2. Controls - the part that took the most iteration

Aiming went through **three designs**. Capturing the exact intent because this
is where feel-feedback loops concentrated:

1. **v1 - Slingshot (rejected).** Right-click drag *backward*, Angry-Birds
   style; launch opposite the pull. Owner: *"instead of doing it as Angry Birds,
   Player actually aims in the direction they want the ball to go."*
2. **v2 - Point-at-target (rejected after play).** Direction = release point →
   cursor; power = cursor's distance from the player. Problem discovered by
   playing: parking the cursor far away instantly gives max power - no
   "charging" gesture, no ritual. Owner: *"now I want it to be so that I have to
   drag it out to add force rather than it just throwing at full force if I
   place the cursor far enough."*
3. **v3 - Hybrid (current).** **Direction** still points from the release point
   to the cursor (you aim *at* things), but **power** is the drag distance from
   where the right-click started (`aim.maxDragPx`, eased by
   `aim.powerExponent`). Deadzone applies to drag length, so a stationary
   right-click cancels.

**The predictive line is the power meter.** This was the answer to *"it's not
very clear how far I can throw the ball"* - instead of a separate power bar,
the dotted line itself communicates everything:

- **Length scales with power** (`previewMinLenM` → `previewMaxLenM`; extended
  +50% on request after the first pass).
- **Heat colors:** dots blend cream → amber → red as power rises.
- **Limit indicator:** at 100% power the line ends in a pulsing red ring - the
  owner explicitly asked that the power *limit* be shown "as part of the dotted
  line somehow".
- **Dissipation:** dots shrink and fade toward the arc's end (no hard cutoff) -
  reference implementation was `bb_ornith.html`'s `drawTrajectory()`
  (`size = 5 - i*0.1`, `alpha = 0.55 - i*0.01`).
- **It never lies:** the dots are produced by the *same* integration as the real
  ball, **including the depth-lane easing** - see Discovery #3 below.

**Other controls:**

- **Left-click:** walk to the clicked floor point (click ripple feedback).
  Walking is clamped: never within 160px of the hoop (see §6) and never off the
  court band.
- **Enter:** focus chat; Enter again sends; Esc blurs. A **Send button** and an
  **emoji picker** (closes after picking one, like Discord) round out the chat
  bar. Chat max length 1000.
- **Control locks:** the teleport power-up introduces graded control -
  `Player.control: "full" | "throwOnly" | "none"` (walk needs `full`, aim needs
  ≥ `throwOnly`).

---

## 3. The ball, the hoop, and physics-true scoring

- **Ball 3× bigger** (0.12m → 0.36m): the original read as "a baseball". The rim
  scaled with it (0.23m → 0.69m half-width) to keep the real-basketball
  ball-to-rim ratio - that ratio is what preserves the swish/rattle skill
  gradient. Later the hoop was **raised 80px** (rim 3.05m → 5.55m; board and
  pole follow).
- **Scoring is decided by physics, not proximity.** Owner: *"make it so the
  physics decides whether the ball made it into the hoop or not."* Model
  matches open-source Messenger-basketball clones
  ([BonbonLemon/basketball](https://github.com/BonbonLemon/basketball)): two
  rim-edge point colliders + the ball must pass *between* them:
  - integration is **substepped** so travel per step ≤ 0.5 ball radius
    (`throw.substepTravelFrac`) - no tunneling at any speed;
  - a basket = the swept segment crossing the rim plane **downward** with the
    interpolated crossing-x inside the opening **by the full ball radius**;
  - a tight depth window (`hoop.scoreDepthM`) gates it.
- **Boundary walls:** physical sandstone walls 300px past *both* baselines
  (`T.wall.offsetPx`) - the ball bounces off them; they are the edges of the
  scene. Explicitly **not** the log wall (see §4).
- **Scoring table:** 100 inside the arc, 250 at the 3pt line +10/m beyond,
  capped 500. Per-shot points > 300 (`score.bigScorePts`) = a "big" shot.

---

## 4. The log - "the court wall"

- Right side of the **screen** (owner: *"the 30% rule, let's apply it to the
  screen rather than the scene"*) - it's a DOM panel, always rightmost, 30% of
  the viewport.
- **Every line is attributed**: `Garry - 12.3m SWISH! +305`, misses too. The
  name comes from the player-name system (§5).
- **Rainbow lines:** any single shot worth > 300 points renders as *"swimming,
  animated rainbow"* text - an animated background-clip gradient plus a gentle
  translate/rotate wobble - and the hoop celebration becomes "a bigger deal"
  (2.5× particles, bigger flash, longer/stronger shake, big pink float text;
  all under `T.juice.big`).
- The log displays emojis natively (it's DOM).
- **Ghost Records:** every hit/miss line is clickable and replays the event on
  the court with 50%-alpha ghosts - 2s before the throw to 3s after the
  outcome, aim indicator excluded, instant switching between recordings. See
  [ghost-records.md](ghost-records.md).
- **Filters (2026-07-11):** the header's ▾ dropdown holds two checkboxes,
  both on by default (persisted in `shootDaHoop.logFilters`): *Ball misses*
  and *Connection events*. Only those two are filterable - chat, made shots,
  and world moments (resets, tier unlocks; log type `world`) always show.
  Hiding is a CSS class on the feed, so it's retroactive and reversible.
  Server-side, every wall entry is also appended (with a timestamp) to a
  permanent per-lobby archive: `data/logs/<lobby>.jsonl`, never trimmed.

Important clarification learned mid-build: at one point the in-scene boundary
wall was styled like the log's brickwork, and the owner corrected it - *"they
are not the same thing."* The log is UI; the walls are world.

---

## 5. Player identity & expression

- **Name:** asked once via a styled DOM overlay on first visit, then remembered
  (`localStorage` key `shootDaHoop.playerName`). Shown above the character -
  **13px bold white with a dark outline (stroke #20303a ×3), full opacity**
  (2026-07-12; the earlier green-at-65%-alpha nameplate was "barely
  perceptible" against the cream sky - an outline works on any backdrop).
  Used in every log line.
- **Character (2026-07-11, parts rig):** composed at runtime from
  owner-drawn part PNGs in `public/assets/` (head ×3 variants, white
  t-shirt torso, trouser band, two floating hand circles - Prison
  Architect / Rayman body plan, outlines baked into the art). Tinted once
  per player: one shared **skin tint** (white→brown, head + hands), a
  **hard shirt tint** on the white torso (any colour - no per-colour
  textures), a subtle **trouser tint**. All rolled per lobby. Poses
  (walk/aim/throw/fall) are positional keyframes in `shared/pose.ts`,
  driven identically for the local player, remote avatars (streamed
  telemetry) and ghost replays; the figure mirrors to face its X travel
  direction. Generated part stand-ins (`ph_*`) cover missing files.
  Full method, anchors, animation list and tuning guide:
  [character-rig.md](character-rig.md).
- **Speech bubbles:** chat messages appear above the head - bubble sized to the
  text (wraps at 220px, up to 1000 chars), **pop-in** animation, **idle
  bob/sway** while "hanging", 5s hold, fade-out. Messages sent while one is
  live wait in a **FIFO queue** and get the full animation treatment. Emojis
  render inside bubbles (canvas text uses the system emoji font).
- **Fonts:** everything bold, both DOM and canvas - reads far better under
  `pixelArt: true`.

---

## 6. The court environment

- **Desert backdrop:** banded warm sky, rolling dune silhouettes (static
  ellipse rows), sand ground.
- **Sun procession** (`src/sky.ts`): an endless parade of suns crossing the
  horizon in 60–120s each, one config at a time, chosen randomly from
  `bigSolo | smallSolo | bigPlusCompanion` - the owner's ask was *"seemingly
  infinite suns in different configurations"*. Each sun = glow + core circles.
- **Dynamic drop shadows:** player, hoop, and ball shadows lean *away* from the
  dominant sun, stretch and fade when it's low, tighten underfoot at apex. The
  reported light direction is **exponentially smoothed** (`sky.lightLerp`)
  because instant switching between suns made shadows "jerky".
- **Keep-out zone:** players can't walk within 160px of the hoop
  (`move.hoopStandoffM = 5.0`; was 6.25/200px, −20% on 2026-07-10). The zone is
  a red-tinted, diagonally hatched floor area - but it's only visible when
  relevant: it **fades in when the player is within 20px** of its line and
  fades back out (owner asked for exactly this proximity reveal).
- **Spawn:** players appear at a random spot inside a 100×100px square just
  outside the keep-out zone (`rollSpawn` in `shared/court.ts`, rolled by the
  authority so every client agrees), with a dust-puff VFX everyone sees.
- **Ball slots:** 5 cosmetic slots, bottom-left (visual only by explicit
  choice - no ammo system yet).

---

## 7. Discoveries / learnings (the bugs that taught us things)

1. **"Is past the plane" checks teleport things; always test the crossing.**
   Two separate bugs came from instantaneous position checks:
   - the hoop "caught" balls from far away - a fast ball could jump ~1m in one
     frame straight into the scoring window;
   - balls that sailed *over* the backboard **teleported back onto its face**
     when they descended on the far side, because `x + r > boardX` is true
     everywhere beyond the board.
   Both fixed the same way: require the swept segment (prev → current) to
   actually cross the plane this substep. Substepping (travel ≤ half a ball
   radius) makes the segments short enough that point colliders can't be
   skipped either.
2. **Reconstructing previous positions after integrating is subtly wrong** -
   `prevH = h - vh*dt` computed *after* gravity mutated `vh` is off by `g·dt²`.
   Capture `prevX/prevH` *before* integrating.
3. **A trajectory preview must simulate *everything* the real flight does.**
   The ball "undershot the dotted line" - because the ball's depth eases toward
   the rim lane mid-flight (a screen-space y shift) and the preview drew at
   constant depth. Once the preview mirrored the easing, ball center and dots
   match exactly. Any hidden term in the integrator *will* be visible as a lie
   in the preview.
4. **`setDisplaySize` + tweens don't compose.** `setDisplaySize` just sets
   scale; a later `tween → scale: 1` silently undoes it. Capture `baseScale`
   after sizing and tween to that.
5. **Generate pixel textures at their display size.** Scaling a 10px generated
   circle to 23px under `pixelArt: true` turns to mush.
6. **CSS specificity traps:** `display: grid` on an element defeats the
   `hidden` attribute (add `[hidden] { display: none }`); `background-clip:
   text` fights inner `<span>` colors - rainbow lines must own the whole line
   as plain text.
7. **Background tabs lie during automation.** Chrome throttles rAF in
   unfocused tabs; the game loop crawls ~100× slow and physics assertions
   silently pass/fail wrong. `page.bringToFront()` before every timing-based
   check. (The scene is exposed as `window.__court`; `__court.sendThrow({vx,
   vh, power}, slam)` gives scripted shots for regression sweeps.)
8. **Outline pixel sprites with a 4-offset silhouette stamp** (draw the figure
   all-black at ±1px offsets, then the colored figure on top) - cheap, clean,
   no shaders.
9. **Keep the DOM/world boundary explicit.** UI panels (log, chat, slots) are
   screen-space and should never be conflated with world objects (walls) - the
   confusion cost a round of rework.
10. **Replays must be data, not re-simulation.** The integrator substeps on
    frame timing, so re-running a throw's initial conditions can resolve
    differently (a rattle-in becomes a rattle-out). Ghost Records therefore
    replay recorded per-frame positions - pixel-identical by construction.
11. **A one-shot plane-crossing test can only fire once - geometry that
    misses that instant is invisible forever.** Lobs onto the *upper*
    backboard tunneled through: the ball's leading edge reached the board
    plane while its *center* was still just above `boardTopM`, the height
    check failed at that single crossing substep, and the descent into the
    board happened past the plane where the crossing test never re-fires.
    Fix: the board is now a **circle-vs-segment overlap** test every substep
    (`collideBackboard`), resolved along the actual contact normal (face,
    top/bottom edge, either side). The substep travel cap (≤ half a ball
    radius) makes overlap impossible to step over, and push-out along the
    contact normal can't teleport far-side balls - so it keeps both old
    regressions fixed while covering the corner cases a plane test can't.

---

## 8. Architecture & file map (post-multiplayer)

Three layers. The split happened in two moves: the foundations refactor
(pure logic out of Phaser) and multiplayer Stage 1 (the shared module +
Backend seam). `MULTIPLAYER.md` in the repo root is the multiplayer spec
and live working doc.

**Shared simulation & rules - `src/shared/`, dependency-free (no
Phaser/DOM/Node), imported by client AND server:**

| File | Owns |
|---|---|
| `shared/config.ts` | `BALANCE` - the single balance surface: court, hoop, throw physics, power curve, scoring (incl. slam points), walls, movement, ground, throw budget, lobby limits |
| `shared/court.ts` | landmarks, walls, clamps, distances - all in meters |
| `shared/physics.ts` | `stepBall(state, dt, geom) → events`: substepped flight, rim/board/wall/ground collisions, swept scoring against every rim of the active tier's hoop |
| `shared/scoring.ts` | distance → points table |
| `shared/simulate.ts` | `resolveThrow(launch, orb, tierId)` - the server-side authority (fixed dt: one launch, one outcome) |
| `shared/tiers.ts` | hoop tiers as data recipes (spec: HOOP_PROGRESSION.md; change-type blocks in `tierChanges.ts`, derived rules in `tierRules.ts`) |
| `shared/balls.ts` | data-driven ball types |
| `shared/budget.ts` | the daily throw budget (pure, unit-tested; UTC-midnight reset) - server enforces it against the profile, `LocalBackend` against a localStorage counter (offline unlimited-practice reversed 2026-07-12) |
| `shared/messages.ts` | the typed client↔server protocol (`ClientMsg`/`ServerMsg`, `ThrowLaunch`, `ThrowOutcome`, history entries) |

**Client - Phaser + DOM, above the Backend seam:**

| File | Owns |
|---|---|
| `src/backend/types.ts` | the `Backend` interface + typed events - the scene never touches a transport |
| `src/backend/local.ts` | `LocalBackend`: single player, in-process echo, the live ball is the authority |
| `src/backend/socket.ts` | `SocketBackend`: live multiplayer over WebSocket; optimistic own-throw spawn; server outcomes |
| `src/tuning.ts` | every client FEEL knob (spreads `BALANCE` so `T.*` works everywhere) |
| `src/world.ts` | meters→px render mapping (re-exports `shared/court`) |
| `src/ball.ts` | Phaser face over the physics stepper: sprite/trail/shadow/sfx, outcome callbacks, consume/pos |
| `src/aiming.ts` | right-click aim: direction at cursor, power by drag; power-meter preview |
| `src/player.ts` | walking, stance, `airH`/`control`, pose state machine, name label, sun shadow |
| `src/characterRig.ts` + `src/shared/pose.ts` | the parts character: tinting, facing mirror, pose smoothing; pure pose math (unit-tested) |
| `src/remoteAvatar.ts` | other players: pose-telemetry interp buffer, walk-intent fallback, name tag |
| `src/powerup.ts` | the orb object itself (see teleport-orb.md) |
| `src/ghost.ts` + `src/ghostData.ts` | ghost playback rendering + pure sample types/interp (see ghost-records.md) |
| `src/sky.ts` | sun procession + smoothed light direction for all shadows |
| `src/speech.ts` | speech bubble queue + animations (`buildBubble` shared with ghosts; bubbles anchor to Player or RemoteAvatar) |
| `src/systems/teleport.ts` | orb lifecycle + hit check + zapp + levitate/fall/down state machine |
| `src/systems/recording.ts` | ghost record capture: rolling history, per-throw recorders, playback wiring |
| `src/systems/shotFeedback.ts` | score/miss juice + attributed log lines |
| `src/scenes/CourtScene.ts` | world construction, system wiring, backend event handling, frame order |
| `src/placeholders.ts` | generated stand-in textures (character parts via `partTexture`), identity rolls (shirt/skin/head), backdrop, court, walls, hoop, keep-out zone |
| `src/hud.ts` | DOM HUD: score, log, chat, emoji picker, send, throw-budget slots |
| `src/playerName.ts` | first-visit name overlay + localStorage |
| `src/main.ts` | backend selection: `?lobby=` → SocketBackend, else LocalBackend |
| `src/juice.ts`, `src/sfx.ts`, `src/cameraRig.ts` | effects, sound, framing (camera tracks `airH`) |

**Server - Node + `ws` (`npm run server`):**

| File | Owns |
|---|---|
| `server/index.ts` | socket accept loop, one `Room` per lobby, created on demand / torn down when empty |
| `server/room.ts` | presence, move-to relay, throw validation + authoritative resolution (outcome scheduled for when the ball lands), chat, snapshots, wall history |
| `server/storage.ts` | `Storage` interface (Postgres/DO swap point) + `JsonFileStorage` (local dev, `data/`) |

## 9. Testing

- `npm test` - vitest: swept scoring (make/swish/rim-graze/
  depth-gate + the far-catch regression), backboard circle-vs-segment
  collision (the board-teleport AND upper-board-tunnel regressions),
  both wall bounces, ground miss/bounce/rest,
  the points table, coordinate mappings/clamps, ghost sample interpolation,
  `resolveThrow` (made/miss/slam/determinism), and the daily budget
  (countdown, exhaustion, UTC-midnight reset, no read-consumes).
- Tests drive the stepper with a FIXED dt, and since 2026-07-16 so does
  live play: the visual ball accumulates frame time and steps in
  `PHYSICS_DT` quanta, exactly like the server's `resolveThrow` - one
  launch is one trajectory everywhere. Tests still assert invariants and
  event outcomes, not exact trajectories.
- Browser smoke: the scene is exposed as `window.__court`
  (`__court.sendThrow({vx, vh, power}, slam)`, `__court.teleport.state`,
  `__court.recording.store`, `__court.remotes`, …). Foreground the tab
  first - background-tab rAF throttling breaks all timing. Two tabs in one
  browser share localStorage; use `?pid=` to give them distinct identities.
- Multiplayer end-to-end: see the README's "Testing multiplayer" section.

## 10. Project direction (owner decisions, 2026-07-09)

- **Multiplayer: BUILT** (Stage 1 + Stage 2 of `MULTIPLAYER.md`, all build
  steps two-browser verified). Remaining: Render/Postgres deploy, the
  Telegram/Discord bot processes, moving the teleport orb server-side.
- **Physics is fixed-step everywhere** (REVISED 2026-07-16; originally
  "non-deterministic on purpose"). The variable-frame-dt visual ball
  could swish while the server's fixed-dt sim ruled a miss - the owner
  hit it constantly and called it the bug it was. Live balls now step in
  the same `PHYSICS_DT` quanta as `resolveThrow`: one launch, one
  trajectory, on every screen. Outcomes stay organic because launch
  params come from analog input. Replays are still data.
- **Persistent world** - no sessions/rounds; players come and go; worlds
  and profiles survive restarts. **Score is shared between players.**
- Touch/mobile input, art/audio pipeline, session design: deferred.
