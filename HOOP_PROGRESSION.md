# Hoop Progression

## Overview

Hoop progression is the game's **shared, per-world sense of growth.** Every made
shot adds to a communal score; when the world has scored enough, the hoop can be
**upgraded** — and an upgrade is never just "a bigger number." Each upgrade
**transforms the court around the players**: the hoop itself changes shape or
behaviour, the environment reskins, new interactive objects and mechanics appear,
and some upgrades grant permanent gameplay boons. The upgrade is a **communal
act** — any single player walks up and triggers it, and everyone in the world
experiences the transformation together (with returning AFK players getting a
catch-up replay of the moment).

This document specifies the upgrade loop, the **modular anatomy** every hoop tier
follows, and the first three tiers in full. It is written so that **adding a new
hoop is editing one self-contained recipe**, not touching the engine: you compose
a tier out of a fixed vocabulary of change-types (below), and the upgrade loop,
syncing, and rendering already know how to play any recipe.

> This is the content layer of the data-driven `hoopTier` structure referenced in
> `MULTIPLAYER.md`. The loop and sync are shared/authoritative; a tier is data.

---

## The upgrade loop (shared across every hoop)

How an upgrade happens, regardless of which tier is being unlocked:

1. **Accumulate.** Every made shot adds `N` to the world's shared score. (`N` and
   each tier's threshold are config values — see *Open items*.)
2. **Call to upgrade.** Once the shared score reaches the next tier's threshold, an
   animated **"Upgrade" button appears under the hoop**. It is *beckoning* —
   animated to visibly "call" a player over to press it.
3. **Trigger (communal).** **Any** player can walk up to the hoop and press the
   button. It doesn't matter who scored the points; whoever presses it triggers
   the upgrade for the whole world.
4. **Transform.** On trigger:
   - **A burst of VFX** fires — lots, all at once.
   - **The shared score resets** (the next tier counts fresh from zero).
   - **All active players are teleported clear of the hoop**, giving the
     transformation room to play.
   - The tier's ordered **change list** plays out (its hoop change, scene changes,
     new mechanics — see each tier below).
5. **AFK catch-up.** A player who was AFK during the upgrade sees, on return,
   **roughly the same success animation** the triggering player saw — so nobody
   misses the payoff of a milestone the community hit.

### Multiplayer, authority & replay

- The upgrade is a **server-authoritative, synced event.** The server owns the
  shared score and the current tier; it validates that the threshold is met and
  broadcasts the tier-unlock so every client plays the same transformation.
- The current tier is part of the world snapshot, so a **late joiner** loads
  straight into the correct, already-upgraded world.
- **Ghost balls** (replayed recordings of past throws) must respect upgrade
  timing: recolour a ghost ball to its post-upgrade look **only if the recording
  being played is already past the upgrade point** — a replay from before the
  upgrade keeps the old look, so the world stays temporally consistent.

---

## Anatomy of a hoop tier (the modular template)

Every hoop tier is one self-contained definition with these parts. **To find or
change a hoop's logic, you open its tier block and read top to bottom.**

- **Identity** — tier number + name.
- **Unlock** — the shared-score threshold to upgrade *into* this tier (counted
  from the reset after the previous upgrade).
- **Hoop change** — how the hoop's geometry/behaviour changes, its upgrade
  animation, and any camera re-fit.
- **Ordered change list** — the sequence of environment/mechanic changes that play
  on upgrade, each one built from a **change-type** below. Order matters: it's the
  choreography of the transformation.

### The vocabulary of change-types (reusable building blocks)

A tier composes its change list out of these. Each block has a consistent shape,
so once you've seen one you can author any of them:

- **Hoop Change** — alters the hoop's shape and/or behaviour (height, rim width,
  single/double/moving/walking). Carries: the new geometry/behaviour, an
  **upgrade animation**, and an optional **camera re-fit** so the new hoop stays in
  frame.
- **Scene Visual Change** — reskins the environment (court floor, background,
  material). Carries: the new look + a **transition animation** (typically a
  "splash" pop).
- **Interactive Element** — adds a placed object or area players can approach and
  trigger. Carries: **placement**, **proximity trigger** (how close + the button
  that appears), **resulting action**, whether the effect is **local or
  synced-to-everyone**, whether interacting **occupies a physical spot** or is a
  press-in-passing, and an **appearance animation**.
- **Permanent Effect** — a lasting gameplay change applied to all players from
  this tier onward (e.g., longer throws). Carries: the effect + any UI/visual
  change that signals it.
- **New Animation** — unlocks a new character animation (e.g., cheering). Carries:
  the animation + its trigger + how it interrupts/yields to normal input.
- **Ambient / Spawn Change** — changes background spawns or their cadence (e.g., an
  orb starting to appear on a timer). Carries: spawn area, frequency, lifetime,
  and appearance behaviour.

Everything below is these blocks with specific parameters filled in.

---

## Hoop 1 — Standard

- **Identity:** Tier 1, "Standard."
- **Unlock:** none — this is the starting state.
- **Hoop change:** none. Standard hoop, the scene exactly as it is now.
- **Ordered change list:** none.

---

## Hoop 2 — Taller Rim, Cheering & Mahogany

- **Identity:** Tier 2.
- **Unlock:** shared score threshold (config — see *Open items*).
- **Ordered change list** (plays in this order):

**1. Hoop Change — taller hoop, wider rim.**
- Geometry: the hoop becomes **+40% taller** and the **rim +15% wider**.
- Animation: a **pop with a splash particle effect** — the new hoop splashes into
  existence and the old one is gone. Sequence: it **gets taller first**, then
  after a **1-second delay** the **rim widens**.
- Camera: **everyone's camera re-fits** so the (now taller) hoop always stays in
  view.

**2. Interactive Element — Cheering Area.**
- Placement: an allocated **wooden-floored area** that appears **upward, over the
  players' usual spawn area, outside the court itself.** Small — enough for **~3
  characters** to comfortably stand.
- Proximity trigger: when a character is **within ~2 px (very close)**, a **"Cheer"
  button** appears over the area. Pressing it walks the character up into the area
  and starts the **cheering animation**.
- Occupies a spot: **yes** — characters physically stand in the area to cheer.
- Yielding to input: when the player clicks to **walk or throw**, the character
  **first walks back down out of the area**, then obeys the input.
- Appearance animation: the area **quickly pops into existence.**
- (Unlocks a **New Animation**, below.)

**2a. New Animation — Cheering.**
- A new character animation unlocked with Hoop 2: characters **bob and throw their
  hands in the air in a quick rhythm.**
- The cheer animation is **already playing while the character walks up** to the
  area (not only once arrived).

**3. Permanent Effect — Ball Upgrade.**
- Effect: **balls travel 25% further** — permanent, all players.
- UI/visual: a **simple splash** on the ball UI; balls become **more red** (both
  the UI icons and the in-world balls). **Ghost balls** also go more red — **but
  only if the played recording is already past this upgrade** (per the replay rule
  above).

**4. Scene Visual Change — Mahogany Court.**
- Look: the **court floor** becomes **much darker, like mahogany wood** (floor
  only).
- Animation: a **splash effect** that turns the court dark.

---

## Hoop 3 — Double Hoop, Jukebox, Glass & Orbs

- **Identity:** Tier 3.
- **Unlock:** shared score threshold (config — see *Open items*).
- **Ordered change list** (plays in this order):

**1. Hoop Change — Double Hoop.**
- Geometry: a **single post carrying two stacked hoops.** Overall height only
  **+10%** over Hoop 2, but it houses **two rims of different sizes** — the
  **upper is slimmer, the lower is wider** — with **enough vertical gap to hit each
  independently.** The **upper hoop protrudes ~20 px further left** (further out)
  than the lower one, which is what enables a **"double shot."**
- Animation: a **pop with splash** — first the hoop **gets taller**, then the
  **upper hoop juts forward** (it sits further out now), then after a delay the
  **second (lower) hoop appears beneath** with another **splash + pop.**

**2. Interactive Element — Jukebox.**
- Placement: **left of the Cheering Area**, off to the side, **off the court.**
- Proximity trigger: like the Cheering Area — when a character is **very close**, a
  button appears **above the jukebox.**
- Resulting action: pressing it plays a **random song, on a loop**, **heard by
  everyone in the world (not local).** Three reference songs will be provided;
  **pressing changes which song is playing** (cycles/re-rolls among them).
- Occupies a spot: **no** — unlike the Cheering Area, characters **don't walk into
  a dedicated space**; they press it in passing from nearby.
- Appearance animation: **pops into existence.**
- Sync note: song choice + playback is **synced to everyone.**

**3. Scene Visual Change — Glass Court.**
- Look: the same full-court area, now **turned to glass and made fancier** than the
  mahogany version.
- Animation: **pops in with a splash effect**, then the glass court appears.

**4. Ambient / Spawn Change — Blue Orbs.**
- Behaviour: the **Blue Orb is the existing in-game interactive object, unchanged
  in function.** After Hoop 3 it **starts appearing on a timer.**
- Spawn area: **same as today.**
- Frequency: a **random interval of 10–20 seconds.**
- Lifetime: the orb now **persists 5 seconds** (up from 3).
- Appearance animation: **none** — it simply comes into existence, no notification.

---

## Adding a new hoop (the layman guide)

You do **not** touch the upgrade loop, the sync, or the rendering. To add Hoop N:

1. **Copy the tier template** (Identity → Unlock → Hoop change → Ordered change
   list).
2. **Set Identity and Unlock** (tier number, name, score threshold).
3. **Fill the Hoop Change** — pick the hoop behaviour (static / double / moving /
   walking / …) and describe its geometry, upgrade animation, and camera re-fit.
4. **Compose the ordered change list** from the change-type vocabulary — each entry
   is one **Scene Visual Change**, **Interactive Element**, **Permanent Effect**,
   **New Animation**, or **Ambient/Spawn Change**, with its parameters filled in.
   Order them as you want the transformation to choreograph.
5. That's the whole definition. Because the engine already knows how to play each
   change-type, a well-formed recipe "just works" through the upgrade loop, syncs
   to everyone, and replays for AFK returners.

If a hoop needs a genuinely new *kind* of change (something none of the six
change-types cover), that's the one case that touches engine code: add the new
change-type to the vocabulary once, then every future hoop can use it as data.

---

## Open items (to define)

- `N` per made shot, and the **score threshold for each tier** (Hoop 2, Hoop 3, …).
- The **three reference songs** for the Jukebox, and the exact
  cycle-vs-random behaviour on press.
- Exact **teleport destinations** for active players when an upgrade fires.
- The precise **AFK catch-up** presentation (full replay vs. condensed success
  beat).
- Ghost-ball system specifics the recolour rule depends on (recording timestamps
  vs. upgrade time).
