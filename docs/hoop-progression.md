# Hoop Progression — how it was built, what we learned, how to extend it

> **What this doc is.** `HOOP_PROGRESSION.md` (repo root) is the *design spec* —
> what each hoop tier is and how the upgrade loop feels. This doc is the
> *engineering companion*: how the feature was actually built (2026-07-13,
> commits `d278fd5…528d214`), the problems hit along the way, and the exact,
> file-by-file recipe for adding a new hoop tier. Read this before touching
> anything tier-related.

---

## 1. The build approach

The whole feature was built **spec-first, then data-driven**: the design doc was
written and agreed on *before* any code, and the code was deliberately split into
an **engine half** (knows how to play *kinds* of changes) and a **content half**
(the tiers themselves, as plain data). The payoff is the core promise of the
system: *adding a new hoop is editing one data file*, not threading a feature
through physics, rendering, networking and the server.

It shipped as 8 incremental commits, each one browser-verified before moving on:

| Step | Commit | What landed |
|---|---|---|
| 1 | `d278fd5` | Tier vocabulary (`tierChanges.ts`), recipes (`tiers.ts`), rules engine (`tierRules.ts`) + tests — pure data, nothing wired |
| 2 | `eeb06a3` | Tier-aware geometry flows through physics, renderer, camera, server validation |
| 3 | `3fd7b8a` | The communal upgrade loop, server-authoritative (threshold → button → press → reset) |
| 4 | `397ea7e` | Choreography engine (`tierDirector.ts`) + Hoop 2 content plays end-to-end |
| 5 | `4c1922f` | Cheer animation + the Cheering Area (first interactive element) |
| 6 | `bff00dd` | Double hoop presentation + double-shot celebration |
| 7 | `62a38e4` | Jukebox (synced to everyone), glass court, tier-3 orb clock |
| 8 | `6d227c0` | AFK catch-up, snapshot-race hardening, docs sweep |

Then three same-day owner-feedback fixes (`39a0072`, `448869e`, `528d214`):
per-lobby throw budgets, hidden-tab snap-to-now, and upgrade button moved to the
hoop base + cheer trigger tuning + per-tier hoop paint.

**Why this order worked:** steps 1–2 made the *existing* game tier-aware while
still looking identical (tier 1 reproduces today's hoop exactly — pinned by
test). Only then did the upgrade loop and content go in. That meant every later
step had a stable, testable substrate, and regressions were caught by the tier-1
"nothing changed" tests.

---

## 2. Architecture — the four files + the server

```
src/shared/tierChanges.ts   ENGINE vocabulary — the six change-type shapes
src/shared/tiers.ts         CONTENT — Hoops 1–3 as ordered recipes  ← edit THIS to add a hoop
src/shared/tierRules.ts     Pure fold: recipes → live gameplay values
src/systems/tierDirector.ts CLIENT player: instant apply vs choreographed upgrade
server/room.ts              AUTHORITY: threshold, upgrade press, validation
src/scenes/CourtScene.ts    Implements the director's hooks (touches Phaser)
```

- **`tierChanges.ts`** — the seven reusable building blocks a tier composes its
  transformation from: `hoop-change`, `scene-visual`, `interactive`,
  `permanent-effect`, `new-animation`, `ambient-spawn`, `atmosphere` (added
  2026-07-14: camera wash + sun mood). Adding a hoop never touches this file;
  only a genuinely *new kind* of change does.
- **`tiers.ts`** — `HOOP_TIERS`: each tier is Identity → Unlock threshold →
  ordered change list. The *order* of the list is the choreography of the
  transformation. Thresholds count **from the shared-score reset after the
  previous upgrade** — they are NOT cumulative.
- **`tierRules.ts`** — pure selectors that *fold* tiers 1..N into the values the
  engine runs on: `hoopGeometryForTier` (multi-rim aware), `effectivePowerForTier`
  (+25% travel = ×√1.25 launch speed, because range ∝ v²), `hoopLookForTier`,
  `ballLookForTier`, `courtLookForTier`, `orbTimingForTier`, `canUpgrade`,
  `clampToWalkable`, and `hoopChoreoGeometries` (the staged mid-animation looks).
  Shared by the server, the offline LocalBackend and the client, so **every
  authority derives the same rules from the same data**. Dependency-free — no
  Phaser, no DOM, no Node.
- **`tierDirector.ts`** — owns the *applied* tier on the client and the two ways
  a world reaches a tier: `applyInstant` (late join, snapshot self-heal, world
  reset) and `playUpgrade` (the live choreography). Also holds the AFK
  defer/replay queue. The scene supplies hooks (`rebuildHoop`, `redrawCourt`,
  `setBallLook`, `spawnInteractive`, `hoopFx`, `clearInteractives`,
  `setAtmosphere`) that actually touch Phaser objects; the director decides
  *what* plays and *when*.
- **`server/room.ts`** — holds `world = { sharedScore, tierId }`. Score
  accumulates on made shots; the tier only advances when a player presses
  Upgrade (`canUpgrade` + proximity check), which resets `sharedScore` to 0,
  broadcasts `upgraded`, and teleports everyone clear
  (`rollUpgradeClearSpot`). Pose sanitizing (`sanePose`) and launch validation
  (`validLaunch`) both read the tier, so cheating past tier rules is rejected.

**The one design invariant to preserve:** gameplay flips **atomically** the
moment the upgrade fires (`tierId` moves immediately — physics, power, camera
all read it); only the *visuals* lag through the choreography beats. Players are
teleported clear at that moment, so nothing meaningful can be thrown at a
half-built hoop. Never make live physics wait on a visual beat.

---

## 3. Problems hit & lessons learned

These all cost real debugging time. Check this list before writing any new
tier-adjacent code.

1. **Pose telemetry lags ~1 server tick** (≈0.37 m at walk speed). A client that
   shows an interact button at exactly the server's proximity radius gets its
   press *rejected* — the server still sees the player slightly further away.
   Fix: the client shows buttons at ~**0.6× the server's radius**. Found on the
   upgrade button; applies to every proximity-gated interaction.
2. **Off-court interactives must have their near edge TOUCHING the sideline.**
   Players clamp to `d ≥ 0`, so a "very close" (few-px) trigger on an element
   floating behind the sideline is physically unreachable. The cheer deck sits
   at `dM: -0.6` with `depthM: 1.2` (edge at d=0), the jukebox at `dM: -0.4`
   with `depthM: 0.8`. Place any new element the same way.
3. **`sanePose` must clamp to `clampToWalkable(tierId)`, not the bare court** —
   otherwise the server snaps remote cheerers (standing on the off-court deck)
   back onto the court. Any new stand-in element with `occupiesSpot: true` gets
   walkable-space treatment for free via `interactivesForTier`.
4. **The upgrade button lives AT the hoop base**, and pressing it walks the
   character *through* the hoop's keep-out zone. This needed
   `Player.walkToUnclamped` (a client errand) plus a server-side rule:
   `clampToWalkable(…, zoneOpen)` opens the zone **only while `canUpgrade` is
   true**. Don't open it unconditionally.
5. **Phaser pauses its clock on window blur.** Browser automation must
   `bringToFront()` the page or timers/choreography silently freeze. The same
   behavior is a *feature* for hidden tabs: they get the AFK catch-up for free.
6. **Hidden tab returning = snap to NOW, no burst replay** (`448869e`): while
   `document.hidden`, skip remote ball spawns, outcome juice, bubbles, puffs,
   zap tweens. The *upgrade choreography* is the one deliberate exception — it
   keeps its held replay so nobody misses the payoff.
7. **Snapshot races with choreography:** a snapshot arriving mid-choreography
   carries the tier we already applied → `applyInstant` no-ops and playback is
   undisturbed. Conversely, a queued AFK replay must not be preempted by a
   snapshot carrying that same tier, but any *other* tier (another upgrade, a
   reset) drops the hold. This logic lives in `TierDirector.applyInstant` —
   don't "simplify" it away.
8. **The tsx server does NOT hot-reload.** Restart `npm run server` after any
   protocol or server-side change. Also: stopping it via TaskStop can orphan the
   tsx child on port 9999 — kill by port before restarting.
9. **Playwright screenshots are device-scaled.** Compute click coordinates from
   `cam.worldView` + `scale.gameSize`, never by eyeballing the image.
10. **Throw budget is PER LOBBY** (`PlayerProfile.budgets[lobby]`,
    `Room.budgetFor`) — a new lobby hands out fresh balls. Any new per-player
    resource should follow the same per-lobby shape.
11. **Physics intuition beats guessing:** "balls travel 25% further" is *not*
    ×1.25 on launch speed — flight range grows with v², so the speed scale is
    √1.25. Encode derivations like this in `tierRules.ts` with a comment, and
    pin them with a test.
12. **Tunables get flagged, not buried.** Every guessed number carries a
    `PLACEHOLDER` comment (23 of them; `grep PLACEHOLDER`). This let the owner
    tune (cheer trigger 2 px → 100 px per side) without archaeology.

---

## 4. Adding a new hoop tier — the full recipe

### 4.1 The fast path (pure data — most hoops)

If the new hoop composes **existing vocabulary** (existing change types AND
existing enum values — court looks, ball looks, element kinds, anim names,
beat names), then the entire change is:

1. **Edit `src/shared/tiers.ts` only.** Copy the previous tier block, append it
   to `HOOP_TIERS`, and fill in:
   - `id`: previous + 1 (ids must be sequential from 1 — tested).
   - `name`: the display name.
   - `threshold`: shared score needed, **counted from the reset after the
     previous upgrade**. Mark it `PLACEHOLDER (tune)` unless the owner set it.
   - `changes`: the ordered list. Order = choreography order.
2. **Add tests to `src/shared/tiers.test.ts`** pinning the new tier's spec
   numbers (geometry fold, power, looks, timing) — the existing tier-2/3 tests
   are the template. If the hoop has stacked rims, assert the gap clears the
   ball (`gap > ballRadius × 2 × 1.5`).
3. **Update `HOOP_PROGRESSION.md`** with a `## Hoop N — <name>` section in the
   same format as Hoops 2–3 (the spec stays the source of truth for design).
4. Run `npx vitest run` and verify in the browser (see checklist in 4.4).

That's it. The upgrade loop, syncing, snapshot self-heal, AFK replay, late-join
instant apply, server validation and camera refit **already work for any
well-formed recipe** — nothing else to wire.

### 4.2 What a finished tier block looks like

A complete, realistic Hoop 4 ("Moving Rim, Neon Night") — this is the shape
every new tier should end up in:

```ts
// ══════════════════════════════════════════════════════════════════
//  Hoop 4 — Moving Rim & Neon Night
// ══════════════════════════════════════════════════════════════════
{
  id: 4,
  name: "Moving Rim & Neon Night",
  // ── PLACEHOLDER (tune): a longer grind than tier 3 ──
  threshold: 8000,
  changes: [
    // 1. Hoop Change — scales are relative to the PREVIOUS tier.
    {
      type: "hoop-change",
      heightScale: 1.05,      // +5% over Hoop 3
      look: {                 // repaint: board / boardEdge / rim / pole
        board: 0x1a1a2e, boardEdge: 0x0d0d18,
        rim: 0x39ff88, pole: 0x101018,
      },
      choreo: [               // the upgrade animation, beat by beat
        { beat: "grow-taller", fx: "pop-splash" },
        { beat: "wait", delayS: 0.8 },       // PLACEHOLDER (tune)
        { beat: "widen-rim", fx: "pop" },
      ],
      cameraRefit: true,
    },
    // 2. Scene Visual Change — new court skin.
    {
      type: "scene-visual",
      target: "court-floor",
      look: "neon",           // ⚠ NEW CourtLookId — see 4.3
      fx: "pop-splash",
    },
    // 3. Ambient / Spawn Change — faster orbs at the top of the ladder.
    {
      type: "ambient-spawn",
      object: "orb",
      cadence: { minS: 6, maxS: 12 }, // PLACEHOLDER (tune)
      lifeS: 4,
      appearFx: "pop",
    },
  ],
},
```

House style for tier blocks (match Hoops 2–3 exactly):

- A boxed `// ═══ Hoop N — name ═══` banner above the block.
- Every change gets a numbered comment (`// 1. Hoop Change — …`) that reads as
  the design-doc sentence it implements.
- Every guessed number gets `PLACEHOLDER (tune)` inline.
- Scales phrased like the doc phrases them: "+40% taller" → `heightScale: 1.4`,
  relative to the **previous** tier (the fold multiplies them).

### 4.3 The slow path (new vocabulary — when data isn't enough)

The moment a tier needs a value or behavior that doesn't exist yet, you extend
the engine **once**, in the narrowest spot, and then the tier still expresses it
as data. Exact touch points by case:

| You need… | Touch these |
|---|---|
| A new **court skin** (e.g. `"neon"`) | `CourtLookId` union in `tierChanges.ts` → teach the `redrawCourt` hook in `CourtScene.ts` to draw it → test in `tiers.test.ts` |
| A new **ball skin** | `BallLookId` union → the `setBallLook` hook (world sprite + UI icons + ghost balls) |
| A new **interactive element** (e.g. `"trampoline"`) | `element` union in `InteractiveElement` → `spawnInteractive` in `CourtScene.ts` draws it → if `synced: true`, add a message case in `server/room.ts` (see the `"jukebox"` case) → if `occupiesSpot: true`, walkable space works automatically via `clampToWalkable`; remember lesson #2 (edge must touch the sideline) and #1 (client trigger at ~0.6× server radius) |
| A new **character animation** | `anim` union in `NewAnimation` → the pose/anim system (see `docs/character-rig.md`); telemetry carries poses, so remote players see it for free |
| A new **hoop behavior** (moving rim, walking hoop…) | New fields on `HoopChange` + new `HoopBeat` names → `foldHoop`/`buildGeometry`/`hoopChoreoGeometries` in `tierRules.ts` → physics reads `hoopGeometryForTier`, so make the *fold* express the motion (e.g. time-parameterized rim x) and keep it pure/deterministic-per-input |
| A new **permanent effect** | New `effect` variant on `PermanentEffect` → a new fold selector in `tierRules.ts` → consume it where the value applies (server validation AND client feel — both, or the server will reject what the client allows) |
| A new **atmosphere mood** (another wash/sun feel) | Usually pure data: an `atmosphere` block in the tier recipe (overlay color+alpha, sun core/glow/size/speed/pulsate). New *capabilities* (e.g. clouds, fog) extend `SunMood`/`AtmosphereChange` in `tierChanges.ts` → `atmosphereForTier` fold → `CourtScene.applyAtmosphere` + `SunSystem.setMood` |
| A genuinely new **kind of change** | Add the shape to `tierChanges.ts` (block #7…), add it to the `TierChange` union → give `TierDirector.playUpgrade`/`applyFinalState` a case → add a fold selector in `tierRules.ts` if it affects gameplay values |

Rules of thumb for extensions:

- **Keep `shared/` dependency-free** (no Phaser/DOM/Node) — the server and
  LocalBackend import it.
- **Anything gameplay-affecting must be folded in `tierRules.ts`** and consumed
  by *both* the server (validation) and the client (feel). If only the client
  knows, the server rejects legal play; if only the server knows, clients
  desync visually.
- **Presentation lives in the director/scene hooks**; the director decides
  what/when, the scene draws. Don't reach into Phaser from shared code.
- **Choreography is presentation-only.** The live geometry is the full tier
  from the moment the upgrade fires; `hoopChoreoGeometries` only stages what
  the *visual* hoop looks like after each beat.

### 4.4 Definition of done — verify before committing

- [ ] `npx vitest run` green, including new tier-pinning tests.
- [ ] Tier N−1 world: score to threshold → Upgrade button appears at the hoop
      base → press → character walks to the hoop → choreography plays in
      recipe order → camera refits.
- [ ] Second browser tab open during the upgrade sees the same show; shared
      score resets to 0 for the next threshold.
- [ ] Fresh late-joiner loads directly into the tier-N world with **no**
      animation (`applyInstant` path).
- [ ] Hide a tab through the upgrade, return → the held choreography replays
      (AFK catch-up), and no burst of stale balls/juice.
- [ ] World reset drops back to tier 1: interactives cleared, hoop/court/ball
      looks restored.
- [ ] New tunables all carry `PLACEHOLDER` comments; `HOOP_PROGRESSION.md` has
      the new hoop's section; commit locally (never push — owner pushes).

---

## 5. Where the tunables live

`grep -r PLACEHOLDER src server` — currently ~23 flagged values. Highlights:
tier thresholds (`tiers.ts`), N-per-made-shot (`server/room.ts` `applyOutcome`
+ `src/backend/local.ts`), upgrade proximity + clear band
(`BALANCE.upgrade`, `rollUpgradeClearSpot` in `src/shared/court.ts`),
choreography beat timings (`T.progressionFx` in `src/tuning.ts`), AFK timeout
(`T.progressionFx.afkTimeoutS`), jukebox behavior (`BALANCE.jukebox` +
`server/room.ts` `"jukebox"` case), songs (`public/assets/music/song1..3`,
silent slots until provided).

---

## 6. Owner-feedback batch, 2026-07-15

Five changes, all browser-verified end-to-end (Playwright + a raw-WS bot as
the second player):

- **Score lives on the hoop only.** The DOM top-center `#score` is gone
  (`index.html`, `style.css`, `hud.ts` — `HUD.setScore` removed). The foot
  screen is the single score display, and once the threshold is met it shows
  **★ ★ ★** instead of `current / required` (`placeholders.ts`
  `setScoreDisplay`).
- **Characters and balls render over the foot screen.** The housing + screen
  + text moved out of the hoop-body graphics into their own objects at
  `sortDepth(RIM.d) − 0.5 / − 0.4` — just UNDER the character band (rigs sit
  at `sortDepth(d)`, ball sprites at `+1`), so anyone at the hoop covers the
  text. Gotcha: the pole had to stop at the housing crown (`baseY −
  housingR + 6`) — a full-length pole in the higher-depth body graphics
  would stripe straight across the lower-depth screen.
- **Tier-2 red is obvious now.** Overlay `0xe03018 @ 0.16` (was `0xff2a18 @
  0.05` — invisible), suns deep crimson `0xd83018` core / `0xff7a55` glow so
  they read against the reddened sky instead of blending into it.
- **The catch-up show survives a closed tab.** New per-lobby seen-tier store
  (`shootDaHoop.seenTier.<lobby>`; `CourtScene.rememberSeenTier`, written on
  every `setWorld` — during a deferred hold it stores the OLD applied tier,
  which is exactly right — and at `playUpgradeShow`). A rejoin whose welcome
  carries a higher tier: `applyInstant(seen)` → `deferUpgrade(worldTier)` →
  1 s beat → the show. `TierDirector.playDeferred` now snaps through
  intermediate rungs and plays the FINAL leg's choreography instead of
  snapping the whole jump.
- **Upgrade presses can't fail silently anymore.** The "character walks up
  but nothing happens" bug was a STALE SERVER: `tsx` doesn't hot-reload, so
  after editing `tiers.ts` thresholds the client showed the button while the
  server still ran the old numbers and ate the press with a bare `break`.
  The server now answers `upgrade-rejected` (`threshold` | `proximity`) to
  the presser, and the client logs it on the court wall — including the
  restart-the-server hint.
