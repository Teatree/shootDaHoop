# Ghost Records — Replay Any Throw From the Log

Click any throw line in the court-wall log (hit **or** miss) and that event
plays back on the court itself as a translucent "ghost" recording.

Implementation: `src/ghost.ts` (recording types + `GhostPlayback`), capture
wiring in `src/scenes/CourtScene.ts` (`recordFrame`, `throwBall`), clickable
lines in `src/hud.ts` + `src/style.css`. Knobs in `T.ghost` (`src/tuning.ts`).

---

## What the player sees

- Throw log lines get a pointer cursor and a `▶` on hover — they're buttons.
- Clicking one pops in (back-ease scale) a **50%-transparency ghost** of the
  player who threw, with their name tag and shadow, at wherever they were
  **2 seconds before the throw** (`ghost.preRollS`). The ghost walks/aims/
  levitates exactly as the original did.
- At the throw moment the ghost ball pops in and flies the **exact original
  path** — rim rattles, board bounces, wall bounces, everything.
- At the recorded hit moment the real net snaps and a small flash fires, so a
  made shot still *reads* as a make. (No score is added, nothing is logged.)
- The recording continues **3 seconds past the hit/miss** (`ghost.postRollS`)
  — enough aftermath to see where the ball ended up — then the ghosts
  **fade out** and are gone.
- Clicking a different log line while one is playing **switches instantly** to
  the new recording (no fade for the interrupted one).
- The **aim indicator is never shown** in a replay — by design (it is simply
  never recorded), the observer doesn't see the thrower's targeting UI.

## Purpose

- **Self-review:** "how did I make that shot?" — replay your own bombs and
  rattle-ins to learn arcs and power.
- **Social groundwork:** the log is styled as a shared court wall for future
  multiplayer; ghost records make every line on that wall a watchable moment,
  not just text. Spectating another player's highlight is the same mechanism.

## Why it replays data, not physics

The physics integrator substeps based on frame timing (`dt` varies per frame),
so re-simulating a throw from its initial velocity can genuinely resolve
differently — a shot that rattled **in** live could rattle **out** in a replay.
Instead, the game records the **actual rendered positions every frame** and the
replay interpolates those samples. The recording is pixel-identical to the
original by construction (verified in testing: ghost ball vs. recorded sample
delta = 0.0px).

## How recording works

1. **Rolling history.** Every frame, the scene samples the player's full
   visual state — `(x, d, airH)`, walk-bob/crouch offset, facing, sprite angle
   (`Player.visualState()`) — into a buffer trimmed to the last ~2.5s.
2. **On throw** (`CourtScene.throwBall`), a `ThrowRecording` is created and
   seeded with the history's last 2 seconds (rebased to t=0). From then on the
   recorder appends the player sample *and* the thrown ball's position every
   frame.
3. **On hit/miss**, the ball's outcome callback stamps `outcomeT`/`made` on the
   recording, and the log line is created with an `onClick` that plays it.
4. Recording continues until `outcomeT + postRollS`, then finalizes. If the
   ball dies early (rest-explode, or consumed by the teleport orb), its samples
   just end — the ghost ball vanishes at that point in the replay. Orb-consumed
   balls have no outcome and no log line, so their recorders are discarded.
5. **Memory bound:** only the last `ghost.maxStored` (25) recordings keep their
   samples; older ones are evicted (their log lines go inert).

Notes:
- Multiple balls can be in flight at once — each has its own recorder; the
  shared player samples go to all of them.
- Teleport-slam throws record like any other (levitation altitude is in
  `airH`), so slam log lines replay the whole aerial sequence.
- Clicking a line whose recording is still capturing its 3s tail is safe: the
  replay reads samples live and can never catch up to the write edge.

## Playback details (`GhostPlayback`)

- One playback at a time; `play()` instantly destroys any current ghosts.
- Ghost objects: player sprite (alpha 0.5), name label, floor shadow, ball
  (display-sized like the real one, spin derived from horizontal motion), ball
  shadow. Positions come from linear interpolation between samples.
- Appear = pop (scale from 0, back-ease). End of recording = fade out
  (`ghost.fadeMs`) then destroy.
- Replays are silent (no sfx) and don't shake the camera — they're
  observations, not events.

## Tuning quick-reference (`T.ghost`)

| Knob | Default | Meaning |
|---|---|---|
| `preRollS` | 2 | seconds of context before the throw |
| `postRollS` | 3 | seconds of aftermath after the hit/miss |
| `alpha` | 0.5 | ghost transparency |
| `popMs` / `fadeMs` | 220 / 450 | appear / disappear animations |
| `maxStored` | 25 | recordings kept before oldest are evicted |
