// ════════════════════════════════════════════════════════════════════
//  HOOP TIERS — the recipes. This is the CONTENT half of the data-driven
//  progression (HOOP_PROGRESSION.md): every tier below is one
//  self-contained definition you can read top to bottom —
//
//    Identity (id + name) → Unlock (threshold) → Ordered change list.
//
//  The change list is composed from the six change-type building blocks
//  in shared/tierChanges.ts; the order is the choreography of the
//  transformation. The upgrade loop, syncing and rendering already know
//  how to play any recipe, so ADDING A NEW HOOP IS EDITING THIS FILE
//  ONLY: copy a tier block, set identity + threshold, compose the list.
//
//  Thresholds count from the shared-score RESET after the previous
//  upgrade (they are NOT cumulative). Every made shot adds its points
//  (100–500, see shared/scoring.ts) to the shared score.
//
//  Dependency-free: no Phaser, no DOM, no Node.
// ════════════════════════════════════════════════════════════════════

import type { TierChange } from "./tierChanges";

export interface HoopTierDef {
  id: number;
  name: string;
  /** shared score needed to upgrade INTO this tier, counted from the
   *  reset after the previous upgrade */
  threshold: number;
  /** the transformation, in the order it plays out */
  changes: TierChange[];
}

export const HOOP_TIERS: readonly HoopTierDef[] = [
  // ══════════════════════════════════════════════════════════════════
  //  Hoop 1 — Standard
  //  The starting state: standard hoop, the scene exactly as it is.
  // ══════════════════════════════════════════════════════════════════
  {
    id: 1,
    name: "Standard",
    threshold: 0, // starting state — nothing to unlock
    changes: [],
  },

  // ══════════════════════════════════════════════════════════════════
  //  Hoop 2 — Taller Rim, Cheering & Mahogany
  // ══════════════════════════════════════════════════════════════════
  {
    id: 2,
    name: "Taller Rim, Cheering & Mahogany",
    // ── PLACEHOLDER (tune): ≈ 4–10 made shots at 100–500 pts each ──
    threshold: 1500,
    changes: [
      // 1. Hoop Change — taller hoop, wider rim.
      {
        type: "hoop-change",
        heightScale: 1.4, //   +40% taller than Hoop 1
        rimWidthScale: 1.15, // rim +15% wider
        choreo: [
          // splashes into existence: taller FIRST…
          { beat: "grow-taller", fx: "pop-splash" },
          // …then after a 1-second delay…
          { beat: "wait", delayS: 1.0 },
          // …the rim widens.
          { beat: "widen-rim", fx: "pop-splash" },
        ],
        cameraRefit: true, // everyone's camera keeps the taller hoop in view
      },

      // 2. Interactive Element — Cheering Area.
      //    A small wooden-floored deck above the players' usual spawn
      //    area, outside the court; fits ~3 characters.
      {
        type: "interactive",
        element: "cheer-area",
        // PLACEHOLDER (tune): over the spawn area, behind the far sideline
        placement: { xM: 19.8, dM: -1.2 },
        widthM: 3.6, // PLACEHOLDER (tune): ~3 characters wide
        proximityPx: 2, // doc: "within ~2 px (very close)", edge-to-edge
        occupiesSpot: true, // characters physically stand in it to cheer
        spots: 3,
        synced: false, // cheering is just your pose — telemetry carries it
        appearFx: "pop", // quickly pops into existence
      },

      // 2a. New Animation — Cheering (bob + hands thrown up in a quick
      //     rhythm; already playing while the character walks up).
      {
        type: "new-animation",
        anim: "cheer",
        trigger: "cheer-area",
        yielding: "walk-out-first", // walk/throw input walks back out first
      },

      // 3. Permanent Effect — Ball Upgrade.
      {
        type: "permanent-effect",
        effect: "ball-range",
        travelScale: 1.25, // balls travel 25% further — permanent, everyone
        ballLook: "red", //  balls become more red (world + UI + new ghosts)
        uiFx: "splash", //   a simple splash on the ball UI
      },

      // 4. Scene Visual Change — Mahogany Court (floor only).
      {
        type: "scene-visual",
        target: "court-floor",
        look: "mahogany", // much darker, like mahogany wood
        fx: "splash", //    a splash effect turns the court dark
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  //  Hoop 3 — Double Hoop, Jukebox, Glass & Orbs
  // ══════════════════════════════════════════════════════════════════
  {
    id: 3,
    name: "Double Hoop, Jukebox, Glass & Orbs",
    // ── PLACEHOLDER (tune): a longer communal grind than tier 2 ──
    threshold: 4000,
    changes: [
      // 1. Hoop Change — Double Hoop: one post carrying two stacked
      //    rims, each hittable independently.
      {
        type: "hoop-change",
        heightScale: 1.1, // overall height only +10% over Hoop 2
        doubleHoop: {
          // upper is slimmer and protrudes ~20 px further left (further
          // out) than the lower — what enables the "double shot"
          upper: { rScale: 0.8, protrudeLeftPx: 20 }, // rScale PLACEHOLDER (tune)
          lower: { rScale: 1.0 }, // keeps the tier-2 width → the wider one
          gapM: 2.0, // PLACEHOLDER (tune): enough vertical gap to hit each
        },
        choreo: [
          // pop with splash: first it gets taller…
          { beat: "grow-taller", fx: "pop-splash" },
          // …then the upper hoop juts forward (sits further out now)…
          { beat: "upper-juts-forward", fx: "pop" },
          // …then after a delay…
          { beat: "wait", delayS: 0.8 }, // PLACEHOLDER (tune): doc says "a delay"
          // …the second (lower) hoop appears beneath with splash + pop.
          { beat: "lower-appears", fx: "pop-splash" },
        ],
        cameraRefit: true,
      },

      // 2. Interactive Element — Jukebox. Left of the Cheering Area,
      //    off the court; pressing plays a random song on a loop, heard
      //    by EVERYONE. Press again to change the song.
      {
        type: "interactive",
        element: "jukebox",
        // PLACEHOLDER (tune): left of the cheering area, off court
        placement: { xM: 16.8, dM: -1.2 },
        widthM: 1.2, // PLACEHOLDER (tune)
        proximityPx: 2, // like the cheering area: very close
        occupiesSpot: false, // press-in-passing — no dedicated space
        synced: true, // song choice + playback synced to everyone
        appearFx: "pop",
      },

      // 3. Scene Visual Change — Glass Court (fancier than mahogany).
      {
        type: "scene-visual",
        target: "court-floor",
        look: "glass",
        fx: "pop-splash", // pops in with a splash effect
      },

      // 4. Ambient / Spawn Change — Blue Orbs. The existing orb,
      //    unchanged in function, now on a slower random timer with a
      //    longer life, appearing without ceremony.
      {
        type: "ambient-spawn",
        object: "orb",
        cadence: { minS: 10, maxS: 20 }, // random interval of 10–20 s
        lifeS: 5, //                        persists 5 seconds
        appearFx: "none", //                simply comes into existence
      },
    ],
  },

  // To add Hoop N: copy a tier block above, set identity + threshold,
  // compose the ordered change list from shared/tierChanges.ts blocks.
] as const;
