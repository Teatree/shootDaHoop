# The Teleport Orb (Blue Circle) — First Power-Up

The game's first power-up: a pulsing blue orb that hangs in the air near the
hoop. Hit it with a thrown ball and the player is zapped up to its position for
a brief, high-value aerial shot — the **teleport slam**.

The orb is a **server-authoritative world object** (since 2026-07-09): the
authority — the server `Room` in multiplayer, `LocalBackend` offline — owns
spawn timing, position, expiry, and consumption; every client renders the
same orb and hears the same ruling.

Implementation map:

- `src/shared/orb.ts` — the orb as data + pure rules: `OrbState`,
  `rollOrbSpawn` (spawn position), `orbHitTest` (the ONE ball-overlap rule).
- `src/shared/config.ts` `BALANCE.orb` — gameplay knobs (cadence, lifetime,
  radius, spawn zone, levitation window). Shared with the server.
- `server/orb.ts` (`OrbAuthority`) — the server-side lifecycle clock;
  `server/room.ts` broadcasts `orb-spawned` / `orb-removed` / `teleported`
  and rules hits by simulating each throw's arc against the live orb
  (`resolveThrow(launch, orb)`), confirming when the ball visually arrives.
- `src/backend/local.ts` — the same lifecycle offline (single player is
  its own authority; the live ball's hit report is trusted there).
- `src/powerup.ts` — RENDER side only: draws the told state, answers
  overlap queries for the local player's own balls.
- `src/systems/teleport.ts` — own-ball hit check (optimistic zap; the
  authority's ruling dedupes by orb seq) + the levitate/fall/face-down
  state machine. `src/remoteAvatar.ts` replays the same arc for others.

Client feel numbers stay in the `T.tp` block of `src/tuning.ts`; the slam's
point value lives in `BALANCE.score.slamPts` (`src/shared/config.ts`).

> **Server-side slam validation:** the `slam` flag on a launch is only
> honored if the server itself teleported that player within the last
> `levitateS + 1.5s` — a client can no longer fake levitation for the
> 500-point payout.

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
| Cadence | `orb.cadenceS = 5` | next orb appears 5s after the previous one is gone (expired **or** consumed). Only one orb exists at a time. |
| Lifetime | `orb.lifeS = 5` | unhit orbs disappear after 5 seconds |
| Position: height | `orb.aboveHoopM = 3.125`, `orb.rangeHM = 1.5625` | rim height + 3.125m, plus 0–1.56m random |
| Position: x | `orb.rangeXM = 3.125` | 0–3.125m from the keep-out zone's edge, toward mid-court |
| Position: depth | rim lane (`RIM.d`) | thrown balls converge to this lane, so the orb is genuinely hittable |
| Hit test | `orb.radiusM = 0.3575`, `orb.hitDepthM = 0.6` | hit when ball center is within orb radius + ball radius, inside the depth window (radius was 0.55; −35% on 2026-07-10) |
| Appear | pop animation (`tp.popMs`, back-ease scale from 0) |
| Idle | pulsating core + a soft light "shining" behind it (breathing glow), `tp.pulseHz` |
| Disappear | fade-out (`tp.fadeMs`); a fading orb can no longer be hit |

(Gameplay knobs live in `BALANCE.orb`; pop/fade/pulse are client feel in
`T.tp`.)

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
4. **Levitate — 3 seconds** (`orb.levitateS`), sinking slowly the whole time
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

- **One orb at a time**, ever — per WORLD now, not per client.
- **Only your own balls trigger your teleport.** Remote players' balls are
  cosmetic on your screen; their orb hits arrive as the server's
  `teleported` ruling and play the zap/levitate/fall arc on their avatar.
- **No chained teleports:** orb hits are ignored unless the player is in the
  normal grounded state — a slam ball flying through a fresh orb does nothing.
- The consumed ball never scores or logs a miss; the orb replaces its outcome
  (in multiplayer the `teleported` event carries the throwId so every client
  pops that ball).
- Fading (expiring) orbs are not hittable.
- **Race rule:** if two balls are heading for the same orb, the first to
  *arrive* (per the server's fixed-dt arcs) takes it; the loser's throw
  plays out as a plain arc.
- Camera, name tag, speech bubbles, and the sun-shadow all track the player
  through the whole airborne sequence (`Player.airH` drives them).
- Control gating is centralized in `Player.control`:
  `"full"` (normal) → `"throwOnly"` (levitating) → `"none"` (falling / lying).

## Multiplayer notes

- The hit is predicted **optimistically** for your own ball (instant zap, the
  prototype feel); the server's ruling — same shared `orbHitTest` on the same
  arc, fixed dt — confirms it ~a flight-time later. Dedup is by orb `seq`.
- **The slam is a FREE throw** (decided 2026-07-10): hitting the orb keeps the
  ball — the server refunds the throw when it confirms the hit
  (`refundThrow`, `src/shared/budget.ts`) and pushes the corrected count. Net
  cost of an orb play = 1 throw, same as any other throw. Hitting the orb with
  your last ball therefore leaves you the slam. Offline the `LocalBackend`
  applies the same refund against its localStorage budget (2026-07-12, when
  the daily budget started applying offline too).
- Late joiners get the live orb in `welcome`; snapshots carry it too
  (adopt-only self-heal).

## Tuning quick-reference

Gameplay: `BALANCE.orb` in `src/shared/config.ts` — cadence, lifetime, orb
size, spawn window, hit depth window, levitation length. Feel: `T.tp` in
`src/tuning.ts` — pop/fade/pulse timings, sink speed, lie-down time, get-up
duration, weak-throw strength. Slam points: `BALANCE.score.slamPts`.
If the orb feels too hard to hit, raise `orb.radiusM`; if slams feel too
easy, shorten `orb.levitateS` or raise the spawn height range.
