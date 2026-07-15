# The character rig - parts, tints, and programmatic animation

*(Built 2026-07-11, replacing the generated single-sprite character.
This documents the method, where everything lives, and how to tune it.)*

## The method in one paragraph

The character is **composed at runtime from five owner-drawn part
images** (head, t-shirt torso, trouser band, two floating hand circles -
a Prison Architect / Rayman body plan with no arms or legs) held in one
Phaser container. Every animation is **positional**: a pure function maps
a pose state to per-part pixel offsets, and the rig eases the parts
toward those targets. Nothing except the whole figure ever rotates -
tiny pixel art shears into mush under per-part rotation, and circles
(the hands, the head) don't need it. Because the pose math is pure and
shared, the local player, remote avatars (from streamed telemetry) and
ghost replays all render **the exact same poses from the same data**.

## Where things live

| Piece | File |
| --- | --- |
| Part art (user-drawn) | `public/assets/head_v1..3.png`, `body_upper.png`, `body_lower.png`, `left_hand.png`, `right_hand.png` (sizes in `public/assets/README.md`) |
| Assembly reference | `guy.png` + `PlayerCharacter.psd` in git history (checkpoint `1e0556d`) |
| Pose math (pure, unit-tested) | `src/shared/pose.ts` - all tuning constants are here |
| Pose tests | `src/pose.test.ts` |
| The Phaser rig | `src/characterRig.ts` |
| Local player state machine | `src/player.ts` (`poseState()`, `currentKind()`) |
| Remote rendering | `src/remoteAvatar.ts` (telemetry buffer + fallback) |
| Ghost replays | `src/ghost.ts` (renders a rig from `FrameSample`s) |
| Generated fallbacks | `src/placeholders.ts` (`ph_*` textures via `partTexture()`) |
| Identity rolls | `src/placeholders.ts` (`persistentSkin/Lower/Head/Shirt`) |
| Wire format | `src/shared/messages.ts` (`AvatarState`, `Cosmetics`, `pose` msg) |

## Coordinate system & anchors

Pose space is **feet-relative, facing-right, +y UP** in native art pixels
(figure ≈ 54×64, `FIGURE_H = 64`). The rig converts to Phaser (+y down)
and mirrors the whole container (`scaleX = −1`) to face the X direction
of travel or aim. Anchors (`PART_ANCHORS` in `shared/pose.ts`) are where
parts rest; the current owner-tuned values:

| Part | Anchor | Notes |
| --- | --- | --- |
| `lower` | (0, 6) | trouser band on the floor |
| `upper` | (0, 26) | shirt tucks INTO the band |
| `head` | (1, 49) | crown ≈ 64 |
| `handL` / `handR` | (∓20, 21) | hanging low at the sides |

**Draw order (back → front):** right hand, shirt, trouser band, head,
held ball, **left hand** - so the left hand is the "front" hand (it
scratches the belly, grips the held ball), the right hand swings behind
the body, and the band overlaps the shirt hem.

## The two positioning rules (important when tuning)

- **Relative poses** (walk swing/bob, idle breathing) are offsets from
  the anchors - they *should* follow anchor tuning automatically.
- **Absolute poses** (aim hold, throw sweep, fall/lie/getup hands-up,
  belly-scratch target) are pinned to feet-relative coordinates via
  `off()` - anchor tuning must **not** move them. This was a real bug
  once: hands-up was relative, and three rounds of "move the resting
  hands down" silently dragged the raised hands to face height. Tests
  now assert raised hands / held ball clear the head anchor in absolute
  terms.

Another transform gotcha: container rotation applies in **screen space
after the mirror**, so the walk-lean tilt is negated when facing left
(`characterRig.ts`) to keep leaning into the travel direction. The
face-plant `angle` stays screen-space on purpose (original behaviour).

## Tinting (once per rig, zero per-frame cost)

| Part | Policy | Why it works |
| --- | --- | --- |
| head + both hands | **one shared skin tint**, gentle white→brown ramp (`SKIN_TINTS`) | multiply-tint over the pale art tans it; `0xffffff` = as drawn |
| `body_upper` | **hard tint = shirt colour** | the art is white, so multiply = exact colour; any colour works, no per-colour textures |
| `body_lower` | subtle shade tint (`LOWER_TINTS`) | variation over its own brown |

All rolled **once per lobby** (localStorage `shootDaHoop.skin/lower/head.<lobby>`,
same pattern as name/shirt), carried in `PlayerInfo`, persisted in the
server profile, and sanitized server-side (`safeTint`, `clampHead`).
Known trade-off: hair/beard darkens slightly with the skin tint
(multiply hits the whole head texture); split hair to its own layer if
that ever grates.

## The animations (`PoseKind` in `shared/pose.ts`)

| Kind | What it looks like | Clock / params |
| --- | --- | --- |
| `idle` | streamed as a constant; each client locally adds **breathing** (per-character rolled rate/depth + random phase - crowds never sync) and a **belly itch** every 1–3 min (front hand eases to the belly, scrubs ~7 Hz for 1.6 s) | rig-local clock; `rollIdleTraits`, `rollItchDelayS`, `idlePose` |
| `walk` | body bob (the prototype's exact feel), hands swinging in antiphase with a small arc lift, ~2.5° lean **into** the travel direction, figure mirrored to face it | `t` = accumulated walk time |
| `aim` | ball held above the crown; the hold **leans with the live aim angle and pulls back with power** (slingshot read - this is the aim telegraphy) | `aimAngle` (body-relative), `aimPower` 0..1 |
| `throw` | 150 ms follow-through sweep from the charged hold to full extension along the launch direction | `t` = 0..1 progress |
| `fall` | both hands straight up beside the crown, waggling | `t` drives the waggle |
| `lie` | face-planted (rig rotated 90° by the teleport tween), hands still up | static |
| `getup` | the stand-up tween window - hands only come down once fully upright | detected via `rig.angle > 0.5` |

**Backwards aiming** turns the character around: `bodyAim(angle)` splits
a world angle into `facing ±1` + a body-relative (always forward) angle
*before* the pose is streamed or recorded, so observers and ghosts
replay the turn from the `facing` field with no extra wire data.

## Sync (see MULTIPLAYER.md "Syncing" + build step 11)

`AvatarState` = `{x, d, airH, facing, angle, pose}` - one format for the
~12 Hz `pose` telemetry (0.4 s keep-alive when still; idle clocks are
zeroed so standing players go wire-silent), for ghost `FrameSample`s,
and for replays. Remote avatars render ~150 ms in the past and lerp
between samples (`sampleAt`/`lerpFrame`); a stale stream (> 0.7 s) falls
back to the original move-to intent walk. The rig's own exp-smoothing
(`SMOOTH_RATE = 18/s`) is what makes 12 Hz look continuous and pose-kind
switches ease instead of snap.

## Tuning guide

Everything is a named constant in `src/shared/pose.ts`: anchors
(`PART_ANCHORS`), walk (`BOB_*`, `SWING_*`, `WALK_TILT`), aim/throw
(`HOLD_BASE`, `PULLBACK_PX`, `THROW_REACH`, tilt constants), fall
(`HANDS_UP`, `WAGGLE_*`), idle (`rollIdleTraits`, `BELLY`, `SCRATCH_HZ`,
`ITCH_DURATION_S`). Throw duration is `THROW_ANIM_S` in `src/player.ts`;
part smoothing is `SMOOTH_RATE` in `src/characterRig.ts`. After touching
anchors, run `npx vitest run src/pose.test.ts` - the absolute-position
assertions catch pose drift.

## Testing notes

- Force an itch instantly: `__court.player.rig.nextItchAt = __court.player.rig.idleT`
- Pose a fake aim: `__court.player.enterStance(); __court.player.aimInfo = {angle: 0.9, power: 0.7}`
- Trigger a fall: `__court.teleport.confirmTeleport({x, d, h: 4})` then `__court.teleport.onThrowReleased()`
- Two-tab telemetry: hidden Playwright tabs keep streaming (no background
  throttling), but ordinary hidden browser tabs stall RAF - step
  `__court.game.loop.step(...)` manually per the established recipe.
