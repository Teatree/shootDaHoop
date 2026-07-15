# Ghost Records - Replay Any Throw From the Log

Click any throw line in the court-wall log (hit **or** miss) and that event
plays back on the court itself as a translucent "ghost" recording.

Implementation: `src/ghostData.ts` (pure sample types + interpolation),
`src/ghost.ts` (`GhostPlayback` rendering), capture in
`src/systems/recording.ts` (rolling history, per-throw recorders, outcome
stamps), clickable lines in `src/hud.ts` + `src/style.css`. Knobs in
`T.ghost` (`src/tuning.ts`).

> **Multiplayer note:** recordings are captured for YOUR throws only -
> remote players' outcome lines (and history lines replayed on join) are
> not clickable. Replaying others' throws needs remote-avatar history
> capture; the sample format already supports it (deferred, tracked in
> `MULTIPLAYER.md`).

---

## What the player sees

- Throw log lines get a pointer cursor and a `▶` on hover - they're buttons.
- Clicking one pops in (back-ease scale) a **50%-transparency ghost** of the
  player who threw, with their name tag and shadow, at wherever they were
  **2 seconds before the throw** (`ghost.preRollS`). The ghost walks/aims/
  levitates exactly as the original did.
- **Teleport slams rewind further:** the recording starts **4 seconds before
  the orb was hit** (`ghost.slamPreRollS`), so the observer sees the whole
  power-up play - the orb hanging there (rendered half-transparent, pulsing),
  the lob that hit it, the **zapp effect at both ends of the jump**, the
  levitation, and the slam.
- **Speech bubbles replay too:** any bubble the player had up during the
  recorded window appears above the ghost at half transparency, with the same
  pop-in and idle bob.
- At the throw moment the ghost ball pops in and flies the **exact original
  path** - rim rattles, board bounces, wall bounces, everything.
- At the recorded hit moment the real net snaps and a small flash fires, so a
  made shot still *reads* as a make. (No score is added, nothing is logged.)
- The recording continues **2 seconds past the hit/miss** (`ghost.postRollS`)
  - enough aftermath to see where the ball ended up - then the ghosts
  **fade out** and are gone.
- Clicking a different log line while one is playing **switches instantly** to
  the new recording (no fade for the interrupted one).
- The **aim indicator is never shown** in a replay - by design (it is simply
  never recorded), the observer doesn't see the thrower's targeting UI.

## Purpose

- **Self-review:** "how did I make that shot?" - replay your own bombs and
  rattle-ins to learn arcs and power.
- **Social groundwork:** the log is styled as a shared court wall for future
  multiplayer; ghost records make every line on that wall a watchable moment,
  not just text. Spectating another player's highlight is the same mechanism.

## Why it replays data, not physics

The physics integrator substeps based on frame timing (`dt` varies per frame),
so re-simulating a throw from its initial velocity can genuinely resolve
differently - a shot that rattled **in** live could rattle **out** in a replay.
Instead, the game records the **actual rendered positions every frame** and the
replay interpolates those samples. The recording is pixel-identical to the
original by construction (verified in testing: ghost ball vs. recorded sample
delta = 0.0px).

## How recording works

1. **Rolling history.** Every frame, the scene samples a `FrameSample` - the
   player's full visual state (`(x, d, airH)`, walk-bob/crouch offset, facing,
   sprite angle via `Player.visualState()`) **plus the teleport orb's
   position/pulse-age and the current speech bubble's text/age** - into a
   buffer trimmed to the last ~8s (long enough for a slam's rewind).
2. **On throw** (`RecordingSystem.beginThrow`, called when the scene spawns
   your ball), a `ThrowRecording` is created and
   seeded from the history - the last 2 seconds for a normal throw, or
   everything since **4 seconds before the orb hit** for a slam (the teleport
   moment and both jump endpoints are stamped on the recording so the zapp
   can replay). From then on the recorder appends the frame sample *and* the
   thrown ball's position every frame.
3. **On hit/miss**, the ball's outcome callback stamps `outcomeT`/`made` on the
   recording, and the log line is created with an `onClick` that plays it.
4. Recording continues until `outcomeT + postRollS`, then finalizes. If the
   ball dies early (rest-explode, or consumed by the teleport orb), its samples
   just end - the ghost ball vanishes at that point in the replay. Orb-consumed
   balls have no outcome and no log line, so their recorders are discarded.
5. **Memory bound:** only the last `ghost.maxStored` (25) recordings keep their
   samples; older ones are evicted (their log lines go inert).

Notes:
- Multiple balls can be in flight at once - each has its own recorder; the
  shared player samples go to all of them.
- Teleport-slam throws record like any other (levitation altitude is in
  `airH`), so slam log lines replay the whole aerial sequence.
- Clicking a line whose recording is still capturing its 3s tail is safe: the
  replay reads samples live and can never catch up to the write edge.

## Playback details (`GhostPlayback`)

- One playback at a time; `play()` instantly destroys any current ghosts.
- Ghost objects: player sprite (alpha 0.5), name label, floor shadow, ball
  (display-sized like the real one, spin derived from horizontal motion), ball
  shadow, **half-alpha orb (glow + pulsing core)**, and a **half-alpha speech
  bubble** (built by the same `buildBubble` the live chat uses). Positions
  come from linear interpolation between samples; the zapp replays as a blue
  ring + particle burst at both recorded jump endpoints.
- Appear = pop (scale from 0, back-ease). End of recording = fade out
  (`ghost.fadeMs`) then destroy.
- Replays are silent (no sfx) and don't shake the camera - they're
  observations, not events.

## Tuning quick-reference (`T.ghost`)

| Knob | Default | Meaning |
|---|---|---|
| `preRollS` | 2 | seconds of context before the throw |
| `slamPreRollS` | 4 | slams rewind to this long before the ORB HIT |
| `postRollS` | 2 | seconds of aftermath after the hit/miss |
| `alpha` | 0.5 | ghost transparency |
| `popMs` / `fadeMs` | 220 / 450 | appear / disappear animations |
| `maxStored` | 25 | recordings kept before oldest are evicted |
