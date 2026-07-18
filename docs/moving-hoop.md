# The Moving Hoop (Hoop 4) - and the 2026-07-18 batch

Owner spec 2026-07-18. Hoop 4 ("Moving Hoop, Sunshine & Chalk",
threshold 4000) brings the game's first TIME-VARYING geometry: the rim
and backboard ride a slow vertical carriage while the pole stands,
dwelling a random 2-4 s at each end. This doc is the how and the why;
the tier recipe itself is data in `src/shared/tiers.ts` like every
other rung.

## The shared clock (src/shared/hoopMotion.ts)

Multiplayer + deterministic physics both need every screen AND the
server to agree on where the hoop is at any instant - and the random
dwells make "just lerp a phase" insufficient. The answer is the jukebox
`startedAtMs` pattern, extended with a seed:

- At the upgrade the authority rolls ONE `HoopMotionState`
  `{ seed, anchorMs }` into `WorldState.hoopMotion`. It rides every
  world payload (welcome/snapshot/outcome/upgraded) and persists with
  the bundle for free.
- `motionLiftAt(spec, state, epochMs)` is a PURE FOLD over epoch time:
  it walks the segment list [dwell-low, rise, dwell-high, fall, ...],
  where dwell k's length = dwellMin + hash(seed, k) * (dwellMax -
  dwellMin) (mulberry32 mix) and each travel leg is a smoothstep ease
  over `travelS`. Anyone holding (spec, state) computes the identical
  timeline forever - no per-move messages, and a server restart changes
  nothing because the anchor is epoch time.
- A cursor memo keeps live 60 Hz queries O(1); out-of-order queries
  (replays) just re-walk from the anchor.
- `hoopGeometryAt(tierId, state, epochMs)` = the static folded geometry
  with the lift applied to rims + board (the owner's "the wall moves
  together with the rim"; boardX and the pole never move). It returns a
  FRESH copy - the `hoopGeometryForTier` cache is never mutated.

## One launch = one trajectory, against a moving target

The existing determinism contract (fixed PHYSICS_DT everywhere) gains a
time anchor: `ThrowLaunch.atMs`, stamped by the throwing client at
release.

- The server CLAMPS it at ingress (`clampLaunchStamp`, now-2.5s..+0.5s)
  and relays it clamped - a doctored stamp is worth centimeters at the
  carriage's ~0.5 m/s. `resolveThrow` then trusts the stamp (no wall
  clock inside), reading `hoopGeometryAt(tier, motion, atMs + t*1000)`
  per step - so a given (launch, motion) resolves the same whenever it
  runs (pinned by simulate.test.ts).
- The client's visual `Ball` tracks physics sim time (consumed fixed
  steps, not frame time) and its `geom` getter takes it - the flight on
  screen reads the same hoop timeline the resolver did.
- `fastForwardBall` accepts a geometry-of-time for the hidden-tab
  catch-up.

Known approximation: `willEnterOpening`'s 0.12 s look-ahead ignores rim
motion (< 6 cm mid-travel at these speeds).

## Rendering: the carriage split

`createHoop` renders a FIXED half (pole + foot housing + score screen +
floor shadow) and a CARRIAGE graphics (board, rim strokes, tie arms;
nets are separate objects). `HoopParts.setLift(liftM)` moves the
carriage and keeps `rims[].rimSY` fresh - score juice reads it at
effect time. The pole draws `liftHeadroomM` taller so the ride never
tops out past it. CourtScene:

- drives `setLift(motionLiftAt(..., Date.now()))` every frame,
- re-seats the carriage right after every `rebuildHoop` (else the hoop
  pops to rest height for a frame on each choreo beat),
- frames the camera on the TOP of the travel envelope (`geom()`), so it
  never chases the carriage.

The VISUAL ride switches on at the choreography's `start-moving` beat
(director hook `setHoopMotionVisible`); live physics runs the motion
from the upgrade instant - players are teleported clear, the usual
atomic-flip contract.

## New tier vocabulary

- `doubleHoop: null` in a hoop-change REMOVES an inherited double hoop
  (undefined inherits) - how Hoop 4 goes back to one rim.
- `motion: HoopMotionSpec | null` starts/stops the oscillation.
- New choreo beats: `collapse-to-single`, `start-moving`.

## The rest of the batch (same day)

- **Ghost old-hoop replays**: recordings stamp `tierId`, `hoopMotion`
  and `startedAtMs`; a replay whose tier differs from the live one (or
  that carries a motion schedule) rebuilds ITS hoop half-alpha behind
  the live one (`createHoop` ghost mode - no shadow/foot/screen) and
  snaps the GHOST net at the hit. Legacy recordings infer the tier from
  the stamped ball look (classic -> 1; red is ambiguous -> no ghost
  hoop). Tier-4 replays ride the ghost hoop along the RECORDED
  schedule.
- **AFK statues take the cheer deck**: the waiting-spot logic
  (offline walk AND restart hydrate) fills deck seats first (shared
  `cheerDeckForTier` + `interactiveSpots` - the ONE spot formula the
  client cheer errand also uses), overflow parks on the sideline
  lineup. Upgrades no longer scatter parked statues. The weary cheer
  lights up automatically - remote offline avatars on the deck
  footprint already play it.
- **Lobby scaling**: the Settings invite gained an Expected-players
  slider (2-5); the link carries `?players=N` and the join that CREATES
  the world captures it into `WorldState.expectedPlayers` for life.
  Only tier thresholds scale: `(n/3) * (1 + 0.1*(n-3))` (superlinear -
  bigger crowds are likelier to hold a sharp shooter), rounded to 50:
  2p 0.60x, 3p 1.00x, 4p ~1.47x, 5p 2.00x. Watch for it wherever
  `this.world` is rebuilt from scratch - reset/upgrade must carry it.
- **Pink-purple balls** are a recolored TEXTURE (`ball_pinkpurple`,
  sepia-first ctx.filter chain at boot), because the orange emoji has
  no blue channel for a multiply tint to work with; `ballTexture` /
  `ballTintFor` pair key + tint everywhere, with a tint fallback where
  ctx.filter is unsupported. The aim preview has one tuning block per
  ball look; tier 4's carries `bonusDots: 3` - the owner's "3
  additional dots".
