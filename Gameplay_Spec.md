# Gameplay Feel Prototype - Build Spec

> **Purpose:** a single-player sandbox to find out **what feels good**. Movement,
> camera, aiming, the throw, and the juice around scoring - nothing else.
>
> **Explicitly out of scope for this build:** progression (no ball tiers, no hoop
> unlocks), multiplayer / networking / persistence, character customization beyond
> a random shirt colour, and any ball-inventory depletion. One court, one hoop,
> **unlimited balls.**
>
> A few HUD/log event types below (other players' chat, join/leave) can't fire
> without multiplayer - **build the structure and styling for them, but only local
> events will actually appear** in this prototype.

---

## Scene

- **Camera plane:** Street Fighter / conveyor-belt side-scroller. Side-on view of
  the court; the character moves on a 2D floor - **left/right along the court and
  up/down in depth** (4-directional footing, rendered from the side).
- **Court:** a single basketball court. The **hoop stands on the rightmost side**;
  the player moves around the floor and shoots toward it.
- **Art style:** **cozy** pixel art - warm, inviting, low-stakes. (Tone note: the
  full-vision doc leans gloomy; this feel test deliberately leans cozy. Pick
  whichever reads better once it's on screen.)
- **Rendering:** Phaser pixel-perfect path - `pixelArt: true` (nearest-neighbor,
  no smoothing) and `roundPixels: true` to avoid sub-pixel jitter.

---

## Character

- **Very simple design** - a small pixel-art figure, readable at a glance. No
  detailed customization.
- **Random shirt colour on first launch:** when the player first opens the game,
  assign a random shirt colour and keep it for the session. That's the entire
  identity for now.

---

## Controls

- **Left-click** - walk to the clicked point on the court floor (point-and-click;
  sets an (x, y) floor destination).
- **Right-click + hold** - enter aiming mode; drag to set **angle + power**
  (Angry Birds style). **The character stops the moment aiming begins** - any
  in-progress walk is cancelled and the figure plants into a shooting stance.
- **Release right-click** - throw.

**Camera behaviour:**

- The camera **always keeps both the hoop and the player character in view.**
- As the player walks **away** from the hoop, the camera **zooms out**, revealing
  more of the scene; as they move back toward it, the camera zooms in (cozy,
  detailed framing up close).
- Implement as: frame the bounding box of `{hoop, player}` + padding; zoom is a
  function of their separation; smoothly lerp both pan and zoom (never snap).
- **Max walk distance from the hoop = one full basketball court length.** Clamp
  the player at that boundary (soft invisible wall). At max separation the camera
  is at its most zoomed-out (roughly the whole court in frame).

---

## Ball throw

The heart of the feel test. Aim for a throw that's satisfying to release and to
watch. Every number below is a **tuning knob** - the point of the prototype is to
dial them until it feels right.

**Aiming & power (drag model):**

- Hold right-click and drag **back** from the character (pool-cue / slingshot
  feel). Drag **direction** sets launch angle; drag **distance** sets power.
- Map drag distance to launch velocity with an **eased (non-linear) curve** so
  small pulls give fine control at the low end, clamped to a max power. Linear
  feels worse - ease it.

**Physics (projectile with gravity):**

- The ball launches as a gravity-driven projectile. Resolve the physics in the
  **shooting plane** (horizontal distance toward the hoop × height); apply a
  tunable gravity constant.
- **Bias toward a tall, floaty arc** - real basketball shots have a high apex.
  Avoid flat line-drives; the natural arc should be lofty and readable.
- **Hang time** in roughly the **0.8–1.4s** range tends to feel good - tune to
  taste. Enough airtime to *watch* the shot.
- For the 2.5D look, let the ball's **depth (up/down position) ease toward the
  hoop's lane** during flight, so it visually converges on the rim.
- Add a spin animation and a small **scale "pop"** on release. A subtle motion
  trail helps readability.

**Resolution:**

- Clean pass through the scoring zone → **swish** (big feedback - see Hoop).
- Clip the rim → **bounce** with restitution (let it rattle; drama is good).
- Otherwise → miss (sails past / falls short).

**Aiming arc preview:**

- While aiming, show a **dotted/dashed parabola** tracing the predicted launch
  path. It updates live as angle and power change.
- **Deliberately partial:** the preview is truncated so that, standing at the
  free-throw (penalty) spot, it reaches only **about halfway to the hoop.**
  Implement as a fixed preview length = ~½ the free-throw-line-to-hoop distance,
  applied regardless of where the player stands. It's a *hint*, not a solver -
  keep skill in the shot.

**Landing → explode:**

- After a miss/made shot, the ball drops, **bounces a few times** with decreasing
  height, and once it has **fully come to rest it explodes** (particle burst -
  purely cosmetic juice). Then it's gone; grab another (balls are unlimited).

---

## Hoop

- One hoop, fixed on the right.
- **Lots of visual effects on a score:** on a made basket, go big - net snap,
  flash/pop, particle burst, screen-shake nudge, a satisfying sound. This is a
  primary "does it feel good" moment, so over-juice it and pull back later rather
  than under-doing it.

---

## Rules (scoring)

Score is based on the **floor distance from the shooting position to the hoop**
(court meters). Distances are tunable defaults.

- **Inside the 3-point line (2-point range):** **100 pts** per made basket.
- **At the 3-point line:** **250 pts.**
- **Beyond the 3-point line:** **250 + 10 pts for every meter past the line**,
  capped at **500 pts** (cap reached ~25 m beyond the line).

Only **made** baskets score; misses score 0 (but still log their distance/outcome).

---

## HUD

Layout frame: the **left 80% of the screen is the game viewport**; the **right
20% is the Log** (see below). Score, chat, and inventory sit within the viewport.

- **Score** - ~~displayed squarely in the top-center of the screen~~ *(changed
  2026-07-15)*: the shared score lives **only on the hoop's foot screen** in the
  world (see HOOP_PROGRESSION.md) - no DOM score element. Once the score reaches
  the next tier's threshold the screen shows **★ ★ ★** instead of numbers.
- **Ball inventory** - **bottom-right of the viewport** (just left of the Log),
  **3 static slots showing 3 basketballs.** Cosmetic only right now - slots don't
  deplete; balls are unlimited.
- **Chat input** - an **MMORPG-style text field at the bottom-center.** The player
  types and sends messages; sent messages do **not** float on screen - they appear
  **only in the Log**.

**Log section (the court "wall"):**

- Occupies the **rightmost 20% of the screen width, full height (100%)** - a
  vertical scrolling text feed. Style it to read like the **back wall of the
  court** (it's the diegetic "wall" the court plays against).
- Displays all events as text:
  - **Ball throws and outcomes** - distance, miss / hit / swish, points added.
  - **Chat messages from players** - styled **more prominently** than other lines.
  - **Players joining; players leaving / going idle.**
- **Prototype reality:** without multiplayer, only **your own throws** and **your
  own chat lines** will actually appear. Build the log to categorize and style all
  three event types so it's ready to light up once multiplayer lands, but don't
  fake other-player traffic.

---

## What we're actually testing (feel priorities)

Rank the build's success by these, in order:

1. **The throw** - is releasing a shot satisfying? Is the arc readable and fair?
2. **Score juice** - does making a basket feel great?
3. **Movement + camera** - is walking around and the zoom-out reveal pleasant?
4. **The explode-on-rest** - is it a fun little payoff or does it get annoying?

Keep gravity, power curve, hang time, arc-preview length, camera zoom range, and
the score-effect intensity all as **easily editable constants** - expect to spend
most of the time tuning these, not rewriting logic.