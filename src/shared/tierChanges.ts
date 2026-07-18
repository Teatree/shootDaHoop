// ════════════════════════════════════════════════════════════════════
//  THE CHANGE-TYPE VOCABULARY - the seven reusable building blocks a hoop
//  tier composes its transformation from (see HOOP_PROGRESSION.md).
//
//  This is the ENGINE half of the data-driven progression:
//    • these shapes are what the upgrade choreography knows how to PLAY
//      (client: systems/tierDirector.ts), and
//    • what the rules engine knows how to FOLD into live gameplay values
//      - hoop geometry, throw power, looks, orb timing (shared/tierRules.ts).
//
//  A tier's recipe (shared/tiers.ts) is an ORDERED list of these blocks;
//  the order is the choreography of the transformation. Adding a new hoop
//  never touches this file - only a genuinely new KIND of change does:
//  add the shape here once, teach tierRules/tierDirector to play it, and
//  every future hoop can use it as data.
//
//  Dependency-free: no Phaser, no DOM, no Node.
// ════════════════════════════════════════════════════════════════════

/** Transition effect a change plays with (the "splash pop" family). */
export type FxKind = "pop" | "splash" | "pop-splash" | "none";

/** Court-floor skins the Scene Visual Change can switch between. */
export type CourtLookId = "standard" | "mahogany" | "glass" | "white";

/** Ball skins the Permanent Effect can switch between (world + UI + ghosts). */
export type BallLookId = "classic" | "red" | "pinkpurple";

// ── 1. Hoop Change ────────────────────────────────────────────────────
// Alters the hoop's shape and/or behaviour. Scales are relative to the
// PREVIOUS tier's hoop, exactly as the design doc phrases them
// ("+40% taller" means ×1.4 on whatever came before).

/** One beat of a hoop's upgrade animation - presentation only; the
 *  gameplay geometry flips atomically when the upgrade fires. */
export type HoopBeat =
  | { beat: "grow-taller"; fx: FxKind }
  | { beat: "widen-rim"; fx: FxKind }
  | { beat: "upper-juts-forward"; fx: FxKind }
  | { beat: "lower-appears"; fx: FxKind }
  /** a double hoop folds back into ONE rim (Hoop 4's opening beat) */
  | { beat: "collapse-to-single"; fx: FxKind }
  /** presentation cue: the carriage begins its slow oscillation */
  | { beat: "start-moving"; fx: FxKind }
  | { beat: "wait"; delayS: number };

/** The hoop's paint job - board, rim and pole colours (0xRRGGBB). */
export interface HoopLook {
  board: number;
  boardEdge: number;
  rim: number;
  pole: number;
}

export interface DoubleHoopSpec {
  /** slimmer top rim; its FRONT tip protrudes this many world px further
   *  left (further out) than the lower rim's front tip - the "double shot".
   *  rimNetsAboveLower places the upper rim that many "rim with net"
   *  heights (the lower rim's stroke + hanging net) ABOVE THE LOWER RIM -
   *  the backboard ("hoop wall") does NOT follow it; only the rim and its
   *  pole strut go up. */
  upper: { rScale: number; protrudeLeftPx: number; rimNetsAboveLower?: number };
  /** wider bottom rim (rScale relative to the folded single-rim width) */
  lower: { rScale: number };
  /** vertical gap between the two rims - must clear the ball so each can
   *  be hit independently (asserted in tiers.test.ts) */
  gapM: number;
}

/**
 * Hoop 4's moving hoop: rim + backboard ride a slow vertical carriage
 * between a low and a high stop; the pole never moves. The carriage
 * dwells a RANDOM dwellMinS..dwellMaxS at each stop before moving
 * again - the schedule is a seeded fold over epoch time
 * (shared/hoopMotion.ts), so every client and the server compute the
 * SAME position with no per-move messages.
 */
export interface HoopMotionSpec {
  travelM: number; //   vertical travel between the two stops
  travelS: number; //   seconds low -> high (smoothstep-eased = gradual)
  dwellMinS: number; // the random dwell at each stop...
  dwellMaxS: number; // ...rolled per stop from the seeded schedule
}

export interface HoopChange {
  type: "hoop-change";
  /** × the previous tier's overall hoop height (1.4 = +40% taller) */
  heightScale?: number;
  /** × the previous tier's rim opening width (1.15 = +15% wider) */
  rimWidthScale?: number;
  /** replace the single rim with two stacked rims on one post;
   *  EXPLICIT null removes a previous tier's double hoop
   *  (undefined = inherit whatever came before) */
  doubleHoop?: DoubleHoopSpec | null;
  /** the hoop oscillates vertically from this tier on (null = stops;
   *  undefined = inherit) */
  motion?: HoopMotionSpec | null;
  /** repaint the hoop (board/rim/pole) from this tier on */
  look?: HoopLook;
  /** the upgrade animation, beat by beat, in order */
  choreo: HoopBeat[];
  /** everyone's camera re-fits so the new hoop stays in view
   *  (the camera reads live geometry, so this is documentation-as-data) */
  cameraRefit: boolean;
}

// ── 2. Scene Visual Change ────────────────────────────────────────────
// Reskins part of the environment with a transition animation.

export interface SceneVisualChange {
  type: "scene-visual";
  target: "court-floor"; // later: "background" | "walls" | …
  look: CourtLookId;
  fx: FxKind;
}

// ── 3. Interactive Element ────────────────────────────────────────────
// A placed object or area players can approach and trigger.

export interface InteractiveElement {
  type: "interactive";
  element: "cheer-area" | "jukebox";
  /** world anchor in court meters; dM < 0 is BEHIND the far sideline
   *  (off the court, drawn higher on screen) */
  placement: { xM: number; dM: number };
  /** footprint width, meters (the deck / the box) */
  widthM: number;
  /** footprint depth, meters (how far the element extends in d) */
  depthM: number;
  /** the trigger button appears when the player is within this many
   *  world px of the element's edge (doc: "~2 px - very close") */
  proximityPx: number;
  /** true → characters physically stand in it (walk up, occupy a spot);
   *  false → press-in-passing from nearby */
  occupiesSpot: boolean;
  /** how many characters fit (cheer area: ~3) */
  spots?: number;
  /** true → the resulting action is synced to everyone (jukebox song);
   *  false → the effect is local to the presser */
  synced: boolean;
  /** how the element arrives during the upgrade choreography */
  appearFx: FxKind;
}

// ── 4. Permanent Effect ───────────────────────────────────────────────
// A lasting gameplay change applied to all players from this tier onward.

export interface PermanentEffect {
  type: "permanent-effect";
  effect: "ball-range";
  /** balls travel this much further (1.25 = +25%). The engine derives the
   *  launch-speed scale as √travelScale, since flight range ∝ v². */
  travelScale: number;
  /** the visual that signals it: in-world balls + UI icons + ghost balls
   *  (ghosts only when the recording is from after this upgrade) */
  ballLook: BallLookId;
  /** effect on the ball UI when the upgrade lands */
  uiFx: FxKind;
}

// ── 5. New Animation ──────────────────────────────────────────────────
// Unlocks a new character animation.

export interface NewAnimation {
  type: "new-animation";
  anim: "cheer";
  /** what plays it (the interactive element that hosts it) */
  trigger: "cheer-area";
  /** how it yields to normal input: the character first walks back out
   *  of the hosting area, then obeys the walk/throw click */
  yielding: "walk-out-first";
}

// ── 6. Ambient / Spawn Change ─────────────────────────────────────────
// Changes background spawns or their cadence.

export interface AmbientSpawnChange {
  type: "ambient-spawn";
  object: "orb";
  /** a new orb appears a random minS..maxS seconds after the last ended */
  cadence: { minS: number; maxS: number };
  /** how long each orb persists before fading */
  lifeS: number;
  /** "none" = it simply comes into existence, no notification */
  appearFx: FxKind;
}

// ── 7. Atmosphere Change ──────────────────────────────────────────────
// Recolors the world's LIGHT: a very transparent tint over the whole
// camera (the world "becomes more red") plus a new mood for the sun
// procession. Applied last-wins per tier, like the court skin.

/** How the suns look and move from this tier on. */
export interface SunMood {
  coreColor: number; // the sun disc (0xRRGGBB)
  glowColor: number; // the halo
  sizeScale: number; // × the base radii (0.65 = clearly smaller)
  speedScale: number; // × traverse speed (0.6 = a slower procession)
  pulsate: boolean; //  slow radius pulse
}

export interface AtmosphereChange {
  type: "atmosphere";
  /** full-screen tint over the world (under the DOM HUD) */
  overlay: { color: number; alpha: number };
  sun: SunMood;
  /** repaint the sky itself (the camera's background colour); omitted =
   *  keep the previous tier's sky */
  sky?: number;
  /** true → the recolour FADES across the WHOLE upgrade choreography
   *  (starts with beat 1, lands with the last beat) instead of popping
   *  at its own slot in the ordered list */
  gradual?: boolean;
  fx: FxKind;
}

export type TierChange =
  | HoopChange
  | SceneVisualChange
  | InteractiveElement
  | PermanentEffect
  | NewAnimation
  | AmbientSpawnChange
  | AtmosphereChange;
