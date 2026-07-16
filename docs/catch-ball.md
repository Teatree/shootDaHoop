# Catch the ball

Owner ask (2026-07-16): a player can 'catch' their own ball back if it
misses and flies back to them - once per ball. On a catch the player
gets a centered "CATCH! +🏀" for a second and the throw is refunded.
Caught balls never count as a miss in the share roll or on the court
wall; the wall logs a catch line instead, clickable for a ghost replay.

## The rules, as built

- OWN balls only. To make ownership readable, your ball is tinted with
  `T.ownBallMarker` (a warm cream) MULTIPLIED over the tier's ball look,
  so it composes with the tier-2 red instead of replacing it. Ghost
  replays (always own throws) wear the marker too.
- The catch zone is the character's footprint plus 10% each way
  (`T.catchFeel`): half-extents ~0.93 m in x (from the 54 px shadow) and
  1.1 m in d (from the ~2 m figure), and the ball's center must be
  within `landHM` of the floor.
- The window opens when the LOCAL ball is ruled a miss (first floor
  contact - `stepGround` resolves there) and closes when the ball pops
  (`restDone`, ~0.45 s of rest, or the 15 s safety).
- Once per ball: a successful catch banks a "credit"; the next throw is
  born-from-catch on both ends and is never catchable again.

## Authority split

Physics is non-deterministic across machines by design, so the LANDING
SPOT is the thrower's client's truth. The client detects the catch,
plays it optimistically (ball pop + CATCH! text) and sends
`{t:"catch", throwId}`. The server never re-simulates the landing; it
rules everything else: THEIR throw, ruled a MISS, inside
`catchBall.windowS`, not born from a catch - then refunds (the orb
pattern), retro-marks its history entry (`caught: true`), records a
`{kind:"catch"}` entry and broadcasts `{t:"caught"}`. A refused catch
is a silent skip: the client's optimistic pop simply never refunds.

## "Never a miss" - the deferred-miss scheme

The miss outcome resolves while the ball is still bouncing, but the
catch (if any) happens seconds later. So every client HOLDS a miss line
whose ball is still alive on its screen (`pendingMisses` in
CourtScene):

- ball done, no catch -> flush: the miss logs and (own throws) joins the
  share roll
- `caught` arrives -> drop: the miss never existed anywhere; the catch
  line logs instead
- DOM timeout at `ground.maxLifeS + 2 s` -> force flush: Phaser pauses
  in hidden tabs and a held miss must not survive forever

Late joiners get the same story: `renderHistory` skips outcome entries
with `caught` (the catch entry right after them tells it). The
append-only disk log keeps the raw miss - the forever archive stays raw.

## Ghost replay

Recordings of missed throws no longer stop at `outcomeT + postRollS`;
they run until the ball pops, so the catch moment always lands on tape
(`rec.catchT`, stamped by `RecordingSystem.stampCatch`). The replay
pops the ghost ball there (ball samples end at the pop) and floats a
small "CATCH!" where it vanished.

## Gotchas found while building (browser-verified)

- **The land threshold must clear the ball's rest height.** A grounded
  ball sits at `h = radius` (0.36 m). The first cut used `landHM: 0.35`
  - one centimeter BELOW where any ball can ever be - and no catch
  could ever fire. `landHM` is now `ballRadiusM + 0.2`.
- **The catch races the outcome timer.** The server schedules the miss
  outcome at `resolvedAtS` = floor contact, which is the very instant
  the thrower's client detects the landing. The catch message can beat
  the timer to the server, finding no registered miss. Early catches
  are parked (`earlyCatches`) and retried by `applyOutcome` the moment
  the miss lands. Symptom before the fix: client shows CATCH!, no miss
  line anywhere, but no refund and no catch line either.
- **Backboard ricochets are catchable, and it's great.** A full-power
  brick that bounces off the board back to the shooter's feet is a
  legitimate catch. It reads as a save, not a bug - kept.
