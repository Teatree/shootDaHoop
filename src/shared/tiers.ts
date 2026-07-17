// ════════════════════════════════════════════════════════════════════
//  HOOP TIERS - the recipes. This is the CONTENT half of the data-driven
//  progression (HOOP_PROGRESSION.md): every tier below is one
//  self-contained definition you can read top to bottom -
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
//  upgrade (they are NOT cumulative). PLACEHOLDER (design): "N per made
//  shot" = the shot's own points (100–500, shared/scoring.ts) - change
//  server/room.ts applyOutcome + backend/local.ts if N should differ.
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
  //  Hoop 1 - Standard
  //  The starting state: standard hoop, the scene exactly as it is.
  // ══════════════════════════════════════════════════════════════════
  {
    id: 1,
    name: "Standard",
    threshold: 0, // starting state - nothing to unlock
    changes: [],
  },

  // ══════════════════════════════════════════════════════════════════
  //  Hoop 2 - Taller Rim, Cheering & Mahogany
  // ══════════════════════════════════════════════════════════════════
  {
    id: 2,
    name: "Taller Rim, Cheering & Mahogany",
    // ── Balanced 2026-07-18 for the ENERGY budget (owner call,
    // docs/scoring-curve.md): 3 bad players x 15 min/day = ~6 throws
    // each (5 stock + 1 regen), ~3 close hits -> trio ~990/day ──
    threshold: 1000,
    changes: [
      // 1. Hoop Change - taller hoop, wider rim.
      {
        type: "hoop-change",
        heightScale: 1.4, //   +40% taller than Hoop 1
        rimWidthScale: 1.15, // rim +15% wider
        // the hoop repaints with the tier: dark-gray board, blue rim,
        // darker pole
        look: {
          board: 0x4a4a52,
          boardEdge: 0x2c2c32,
          rim: 0x3a76c4,
          pole: 0x3c3c44,
        },
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

      // 2. Interactive Element - Cheering Area.
      //    A small wooden-floored deck above the players' usual spawn
      //    area, outside the court; fits ~3 characters.
      {
        type: "interactive",
        element: "cheer-area",
        // PLACEHOLDER (tune): over the spawn area, just behind the far
        // sideline - its near edge touches the court so a player can
        // stand "very close" (the ~2 px trigger is edge-to-edge)
        placement: { xM: 19.8, dM: -0.6 },
        widthM: 3.6, //  PLACEHOLDER (tune): ~3 characters wide
        depthM: 1.2, // PLACEHOLDER (tune)
        // owner-tuned 2026-07-13 (was the doc's ~2 px) to 100 px each
        // way from the bench's edges; halved 2026-07-16
        proximityPx: 50,
        occupiesSpot: true, // characters physically stand in it to cheer
        spots: 3,
        synced: false, // cheering is just your pose - telemetry carries it
        appearFx: "pop", // quickly pops into existence
      },

      // 2a. New Animation - Cheering (bob + hands thrown up in a quick
      //     rhythm; already playing while the character walks up).
      {
        type: "new-animation",
        anim: "cheer",
        trigger: "cheer-area",
        yielding: "walk-out-first", // walk/throw input walks back out first
      },

      // 3. Permanent Effect - Ball Upgrade.
      {
        type: "permanent-effect",
        effect: "ball-range",
        travelScale: 1.25, // balls travel 25% further - permanent, everyone
        ballLook: "red", //  balls become more red (world + UI + new ghosts)
        uiFx: "splash", //   a simple splash on the ball UI
      },

      // 4. Scene Visual Change - Mahogany Court (floor only).
      {
        type: "scene-visual",
        target: "court-floor",
        look: "mahogany", // much darker, like mahogany wood
        fx: "splash", //    a splash effect turns the court dark
      },

      // 5. Atmosphere Change - Red Desert. The whole world becomes
      //    OBVIOUSLY red (owner ask 2026-07-15, was a barely-visible
      //    0.05 wash), and the suns turn deep crimson so they still
      //    read clearly against the reddened sky.
      {
        type: "atmosphere",
        // PLACEHOLDER (tune): a clearly visible red over everything
        overlay: { color: 0xe03018, alpha: 0.16 },
        sun: {
          coreColor: 0xd83018, // deep crimson disc - pops on the red wash
          glowColor: 0xff7a55, // hot halo… PLACEHOLDER (tune)
          sizeScale: 1,
          speedScale: 1,
          pulsate: true, // the suns pulsate a bit
        },
        fx: "pop",
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  //  Hoop 3 - Double Hoop, Jukebox, Glass & Orbs
  // ══════════════════════════════════════════════════════════════════
  {
    id: 3,
    name: "Double Hoop, Jukebox, Glass & Orbs",
    // ── Balanced 2026-07-18 (docs/scoring-curve.md): two more of the
    // same trio's 15-minute days at Hoop 2's curve (~945/day) ──
    threshold: 2000,
    changes: [
      // 1. Hoop Change - Double Hoop: one post carrying two stacked
      //    rims, each hittable independently.
      {
        type: "hoop-change",
        heightScale: 1.1, // overall height only +10% over Hoop 2
        // owner 2026-07-15: the hoop turns DARK RED (from tier 2's black
        // and gray); the rims go pink/magenta so they read well on the
        // new light-gray background. PLACEHOLDER (tune): exact shades.
        look: {
          board: 0x7a1a1a, //     dark red board
          boardEdge: 0x4a0e0e, // near-black red edge
          rim: 0xff4fc3, //       pink/magenta rims
          pole: 0x5a1414, //      dark red pole
        },
        doubleHoop: {
          // upper is slimmer and protrudes ~20 px further left (further
          // out) than the lower - what enables the "double shot".
          // owner 2026-07-15 (revised: "1 full hoop height" was too high):
          // the second (upper) hoop sits exactly 2 rim-with-net heights
          // above the LOWER rim; the hoop wall (backboard) stays put, and
          // a pole-coloured strut ties the rim to the post (render-only).
          // rScale PLACEHOLDER (tune) - 1.1, was 0.8: at 0.8 the opening
          // left only +-0.275 m for the ball's CENTER (ball r 0.36) ten
          // meters up - 0.5% of the whole realistic launch space entered
          // cleanly, so to a human the upper "never registered" (owner,
          // three sessions running; measured 2026-07-17, grid script).
          // At 1.1 the center window is +-0.51 m - still the harder rim
          // (it sits 3.5 m above the lower), but honestly hittable.
          upper: { rScale: 1.1, protrudeLeftPx: 20, rimNetsAboveLower: 2 },
          lower: { rScale: 1.0 }, // keeps the tier-2 width → the wider one
          gapM: 2.0, // PLACEHOLDER (tune): the lower rim's drop below the structure top
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

      // 2. Interactive Element - Jukebox. Left of the Cheering Area,
      //    off the court; pressing plays a random song on a loop, heard
      //    by EVERYONE. Press again to change the song.
      {
        type: "interactive",
        element: "jukebox",
        // PLACEHOLDER (tune): left of the cheering area, off court - its
        // near edge touches the sideline so "very close" is reachable
        placement: { xM: 16.8, dM: -0.4 },
        widthM: 1.2, // PLACEHOLDER (tune)
        depthM: 0.8, // PLACEHOLDER (tune)
        // owner 2026-07-16: the interact area grew 3× (was the ~2 px
        // "very close" zone) - comfortably inside the server's 3 m
        // press-validation slack. PLACEHOLDER (tune).
        proximityPx: 38,
        occupiesSpot: false, // press-in-passing - no dedicated space
        synced: true, // song choice + playback synced to everyone
        appearFx: "pop",
      },

      // 3. Scene Visual Change - Glass Court (fancier than mahogany).
      {
        type: "scene-visual",
        target: "court-floor",
        look: "glass",
        fx: "pop-splash", // pops in with a splash effect
      },

      // 4. Atmosphere Change - Light-Gray World (owner 2026-07-15: the
      //    whole background just recolours to light gray, replacing the
      //    old blue-gray dusk wash). The recolour is GRADUAL - it fades
      //    across the whole upgrade choreography, alongside the other
      //    sequences. The suns stay smaller, very light blue and slower.
      {
        type: "atmosphere",
        // PLACEHOLDER (tune): a faint neutral wash pulls the court and
        // characters toward gray too, without dimming them
        overlay: { color: 0xc9cdd2, alpha: 0.1 },
        sun: {
          // owner 2026-07-15: still blueish, but clearly VISIBLE on the
          // light-gray sky (the old very-light-blue vanished into it).
          // PLACEHOLDER (tune): a proper medium blue + a paler halo
          coreColor: 0x5d8fd8,
          glowColor: 0xa9c8f2,
          sizeScale: 0.65, //     clearly smaller suns
          speedScale: 0.6, //     …moving slower
          pulsate: false,
        },
        sky: 0xd9dcdf, // PLACEHOLDER (tune): the light-gray background
        gradual: true, // fades in alongside the other sequences
        fx: "pop",
      },

      // 5. Ambient / Spawn Change - Purple Orbs (recoloured from blue,
      //    owner 2026-07-16, to read on the light-gray sky). THIS change
      //    is what brings the orb into existence at all - it spawns at
      //    no tier below it (orbTimingForTier is null there): a random
      //    timer, a 5 s life, appearing without ceremony.
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
