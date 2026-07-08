# The Teleport Orb (Blue Circle) — First Power-Up

The game's first power-up: a pulsing blue orb that hangs in the air near the
hoop. Hit it with a thrown ball and the player is zapped up to its position for
a brief, high-value aerial shot — the **teleport slam**.

Implementation: `src/powerup.ts` (orb lifecycle) + the `tpState` state machine
in `src/scenes/CourtScene.ts`. All numbers live in the `T.tp` block of
`src/tuning.ts`.

---

## Purpose

- **Risk/reward skill shot.** The orb sits high and slightly *behind* the
  player's usual shooting range, so hitting it costs a deliberate, steep lob —
  a throw that can't score on its own. The reward is a shot from the air worth
  a flat **500 points** (the highest single score in the game, automatically
  triggering the rainbow log line and the big hoop celebration).
- **Tempo/variety.** It appears on a fixed cadence and expires quickly, so it
  punctuates normal shooting with short decision windows: abandon your rhythm
  to chase it, or let it fade.
- **Cost of failure.** Whatever happens up there, the player ends up falling,
  face-planting, and lying helpless for 5 seconds — missing the slam wastes
  meaningful time.

---

## The orb itself

| Property | Value / knob | Detail |
|---|---|---|
| Cadence | `tp.cadenceS = 5` | next orb appears 5s after the previous one is gone (expired **or** consumed). Only one orb exists at a time. |
| Lifetime | `tp.lifeS = 5` | unhit orbs disappear after 5 seconds |
| Position: height | `tp.aboveHoopPx = 100`, `tp.rangeHPx = 50` | rim top + 100px, plus 0–50px random |
| Position: x | `tp.rangeXPx = 100` | 0–100px from the keep-out zone's edge, toward mid-court |
| Position: depth | rim lane (`RIM.d`) | thrown balls converge to this lane, so the orb is genuinely hittable |
| Hit test | `tp.radiusM = 0.55` | hit when ball center is within orb radius + ball radius |
| Appear | pop animation (`tp.popMs`, back-ease scale from 0) |
| Idle | pulsating core + a soft light "shining" behind it (breathing glow), `tp.pulseHz` |
| Disappear | fade-out (`tp.fadeMs`); a fading orb can no longer be hit |

The visual is three circles: a wide low-alpha glow (the light behind it), the
solid blue core, and a small highlight.

---

## Expected player interaction flow

1. **Spot it.** Every ~5 seconds the orb pops in near the hoop, pulsing. The
   pulse + glow + hard 5-second lifetime communicate "act now".
2. **Hit it with a ball.** The player lobs a throw into the orb. The ball is
   **consumed** by the orb (it pops with a zap — no hit/miss is logged for it).
3. **Zapp — teleport.** Blue particle bursts fire at both the player's old spot
   and the orb's position; the player is now suspended in mid-air where the orb
   was.
4. **Levitate — 3 seconds** (`tp.levitateS`), sinking slowly the whole time
   (`tp.sinkSpeedM`, ~0.35 m/s — including while aiming).
   - Control is **throw-only**: aiming works, walking is disabled.
   - This is the chance for the **second throw** — the slam.
5. **The slam throw.**
   - **Make it** → flat **+500** (`tp.slamPts`); log reads
     `Garry — 6.5m teleport slam! +500` (with `SWISH!` if it was clean);
     500 > 300 so the line is rainbow and the hoop celebration is maxed.
   - **Miss it** → log reads `Garry — teleport slam failed!`
   - Throwing **immediately** ends the levitation — the fall starts the moment
     the ball leaves the hands.
6. **Timeout edge case.** If the 3 seconds run out *while the player is still
   aiming*, the aim is interrupted and the ball is auto-thrown **straight up at
   weak force** (`tp.weakThrowVh`) — it counts as the slam attempt (and will
   log `teleport slam failed!` when it lands). If the timer expires and the
   player wasn't aiming, they simply fall without a throw.
7. **The fall.** Gravity takes over. **No control at all** during the fall.
   The player drifts back to the **same depth row they stood on when they hit
   the orb** (they fall at the teleport x, original d).
8. **Face-plant.** On landing the character pivots over their feet and lies
   face-down (animated). They stay down for **5 seconds** (`tp.lieS`) — still
   zero control.
9. **Get up.** An animated stand-up (`tp.getUpMs`), control returns to full,
   and the loop resumes. The next orb is already on its cadence.

---

## Rules & guarantees

- **One orb at a time**, ever.
- **No chained teleports:** orb hits are ignored unless the player is in the
  normal grounded state — a slam ball flying through a fresh orb does nothing.
- The consumed ball never scores or logs a miss; the orb replaces its outcome.
- Fading (expiring) orbs are not hittable.
- Camera, name tag, speech bubbles, and the sun-shadow all track the player
  through the whole airborne sequence (`Player.airH` drives them).
- Control gating is centralized in `Player.control`:
  `"full"` (normal) → `"throwOnly"` (levitating) → `"none"` (falling / lying).

## Tuning quick-reference

Everything under `T.tp` in `src/tuning.ts`: cadence, lifetime, orb size, spawn
window (height above hoop, ranges), pop/fade/pulse timings, levitation length,
sink speed, lie-down time, get-up duration, weak-throw strength, slam points.
If the orb feels too hard to hit, raise `tp.radiusM`; if slams feel too easy,
shorten `tp.levitateS` or raise the spawn height range.
