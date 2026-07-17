// ════════════════════════════════════════════════════════════════════
//  SHARED BALANCE - the single config surface for everything that the
//  SIMULATION and RULES depend on: court geometry, hoop, throw physics,
//  scoring, walls, movement limits, throw budget. Imported by BOTH the
//  client and the (future) server - so it must stay dependency-free:
//  no Phaser, no DOM, no Node.
//
//  Client-side FEEL knobs (camera, juice, aim preview, sky, ghosts…)
//  live in src/tuning.ts, which spreads this object into `T`.
//  Units: meters (m), seconds (s), meters/second (m/s) unless noted px.
// ════════════════════════════════════════════════════════════════════

import { BALL_TYPES, DEFAULT_BALL } from "./balls";

export const BALANCE = {
  // ── Court & coordinate system ─────────────────────────────────────
  court: {
    meterPx: 32, //          world pixels per meter (character is 2m → 64px tall)
    lengthM: 28, //          full court, left baseline → right baseline
    depthM: 6, //            playable depth band (far ↔ near sideline)
    depthPxPerM: 16, //      vertical px per depth meter (side-view foreshortening)
    floorBaseY: 420, //      world-px Y of the floor's FAR edge (depth = 0)
    rimFromBaselineM: 1.575, // rim center distance from the right baseline
    threePtM: 6.75, //       3-point line distance from the rim (floor)
    freeThrowM: 4.225, //    free-throw (spawn) spot distance from the rim
  },

  // ── Hoop geometry & materials (tier 1 "static" hoop) ─────────────
  hoop: {
    rimHeightM: 5.55, //     regulation 3.05 + 2.5 (80 px) - sky hoop
    rimRadiusM: 0.69, //     rim opening half-width (scaled with the 3× ball)
    boardGapM: 0.25, //      gap between back rim and backboard face
    boardBottomM: 5.1, //    backboard vertical extent (tracks the raised rim)
    boardTopM: 8.0,
    rimRestitution: 0.55, // bounciness off the rim (let it rattle)
    boardRestitution: 0.65,
    laneDepthM: 0.45, //     |d − rim lane| where the ball interacts with the hoop
    scoreDepthM: 0.3, //     tighter depth window to actually count the bucket
  },

  // ── Boundary walls - physical scene edges past both baselines ─────
  wall: {
    offsetPx: 300, //      distance past each baseline, world px
    restitution: 0.6, //   horizontal energy kept when the ball hits a wall
  },

  // ── Movement ──────────────────────────────────────────────────────
  move: {
    speedM: 4.5, //          walk speed, m/s
    minXM: 0.4, //           left clamp (far baseline - one court length from hoop)
    hoopStandoffM: 5.0, //   keep-out radius around the hoop (160 world px; was 6.25, -20% 2026-07-10)
    arriveEps: 0.08, //      "close enough" to the click target, m
    spawnAreaM: 3.125, //    players spawn in this square (100 px) just outside the keep-out zone
  },

  // ── Ball flight & physics ─────────────────────────────────────────
  throw: {
    gravityM: 13.0, //       m/s² downward. Lower = floatier (real = 9.8)
    releaseHeightM: 2.2, //  hands-above-head release point (clears the big ball)
    releaseForwardM: 0.5, // ball spawns this far toward the hoop
    depthEaseRate: 2.2, //   how fast depth converges on the rim lane (1/s)
    spinRadPerM: 2.6, //     ball spin ∝ horizontal speed
    // the active ball type's size - ball types are data (see balls.ts)
    ballRadiusM: BALL_TYPES[DEFAULT_BALL].radiusM,
    substepTravelFrac: 0.5, // max travel per physics substep, in ball radii (CCD-ish)
    maxSubsteps: 10,
  },

  // ── Aim power curve (shared: the server validates launch speeds) ──
  power: {
    minPowerM: 3.0, //       launch speed at the softest throw
    maxPowerM: 19.0, //      launch speed at full drag (server rejects faster)
    powerExponent: 1.8, //   >1 = fine control at the low end (eased, non-linear)
  },

  // ── Dead-ball ground behaviour ────────────────────────────────────
  ground: {
    restitution: 0.55, //    bounce energy kept per ground hit
    slideFriction: 0.75, //  horizontal speed kept per ground hit
    restSpeedM: 0.6, //      below this after a bounce → coming to rest
    restDelayS: 0.45, //     pause after settling before the explode
    maxLifeS: 15, //         hard despawn safety net
  },

  // ── Scoring (owner spec 2026-07-17: the logistic distance curve) ──
  // Every make banks basePts; distance adds a logistic bonus anchored
  // at the keep-out edge (move.hoopStandoffM = the closest legal shot,
  // add exactly 0) and flat well before the far baseline. Gains ramp
  // fast just past the zone, then diminish beyond the curve's midpoint.
  score: {
    basePts: 100, //         the "normal score point", at the keep-out edge
    curves: {
      // midM: where gains start diminishing (the logistic midpoint,
      //       measured from the rim); k: steepness; maxAddPts: the
      //       flat-tail ceiling of the distance bonus. Owner correction
      //       2026-07-17: the max ADD equals the base (not 2x it) - a
      //       deep tier-1 bomb tops out at 200, not 300.
      tier1: { midM: 10, k: 0.6, maxAddPts: 100 }, //     max 200, flat ~16 m
      tier2plus: { midM: 12.5, k: 0.5, maxAddPts: 125 }, // max 225, flat ~20 m
    },
    upperRimMult: 1.25, //   the double hoop's smaller upper rim pays more
    bigScorePts: 300, //     per-shot points above this = rainbow log + big juice
    slamPts: 100, //         the purple orb throw pays flat base - a toy,
    //                       not a strategy (was 500, dwarfed the curve)
  },

  // ── Teleport orb (server-authoritative world object) ─────────────
  // The authority (server Room, or LocalBackend offline) owns spawn
  // timing, position, expiry and consumption; clients only render it.
  // Client-side FEEL knobs (pop/fade/pulse, the levitation fall) stay
  // in src/tuning.ts `tp`.
  orb: {
    // cadence/life now come from the tier's Ambient/Spawn Change ONLY
    // (owner 2026-07-16: the orb exists exclusively at Hoop 3) - the
    // values below are the orb's physical shape and spawn area.
    // cadenceS/lifeS removed with that change; see shared/tiers.ts.
    radiusM: 0.3575, //     orb size (hit when ball center is within r+ballR; was 0.55, -35% 2026-07-10)
    aboveHoopM: 5.3125, //  spawn height: rim height + this… (owner 2026-07-16: up 70 px, was 3.125)
    rangeHM: 1.5625, //     …plus 0..this, randomly (was 50 px)
    rangeXM: 3.125, //      spawn x: 0..this left of the keep-out line (was 100 px)
    hitDepthM: 0.6, //      |ball d − orb d| window for a hit
    levitateS: 3, //        suspended this long after teleporting (slam window)
  },

  // ── Upgrade trigger (shared: the server validates presses) ────────
  upgrade: {
    // PLACEHOLDER (tune): how close to the HOOP'S BASE a presser must
    // stand for the press to count - the button sits at the hoop and
    // the errand walks the character through the keep-out zone to it
    proximityM: 2.5,
    // PLACEHOLDER (tune): where players teleport when the upgrade fires
    // - a random spot in this x-band, well clear of the hoop, so the
    // transformation has room to play
    clearMinXM: 8,
    clearMaxXM: 14,
  },

  // ── Presence (offline characters wait around) ─────────────────────
  presence: {
    // PLACEHOLDER (tune): a disconnected player's character waits this
    // long, then walks to its lineup slot on the far sideline
    offlineWalkDelayS: 20,
    // The offline LINEUP (owner ask 2026-07-17): waiting characters
    // stand grayed in a row along the far sideline, as close to the
    // hoop as the court furniture allows - the jukebox (x 16.2-17.4)
    // and the cheer deck (x 18.0-21.6) sit just behind that sideline
    // and must stay visible behind them.
    waitLineStartXM: 15.2, // slot 0 center - clears the jukebox's left edge
    waitLineGapM: 1.2, //    center-to-center: close, but no overlap
    waitLineDM: 0.4, //      on court, hugging the far sideline
    // The lineup SURVIVES restarts (owner ask 2026-07-18): the world
    // bundle carries every offline character, hydrate re-seats them.
    // PLACEHOLDER (tune): how long an abandoned character keeps its
    // spot before the world forgets it, and how many the lineup holds
    // at most (newest leavers win; the row must not run off the court)
    offlineKeepH: 72,
    offlineKeptMax: 8,
  },

  // ── Jukebox (Hoop 3 interactive - synced to everyone) ─────────────
  jukebox: {
    songs: 3, //           the three reference song slots (assets/music/)
    // PLACEHOLDER (tune): server-side press validation slack - the
    // client button needs the doc's "very close", the server just
    // checks the presser is plausibly at the box
    pressProximityM: 3,
  },

  // ── Ball budget, energy-style (owner redesign 2026-07-17): a cap of
  //    balls, one regenerating per interval; the clock starts on the
  //    throw from full. Server-authoritative online; LocalBackend
  //    enforces the same rules offline (shared/budget.ts). ────────────
  budget: {
    ballCap: 5,
    regenMinutes: 10,
  },

  // ── Catch the ball (own missed ball landing at your feet comes back;
  //    the zone geometry is client tuning, this is the authority's part) ─
  catchBall: {
    // PLACEHOLDER (tune): the authority forgets a miss this long after
    // it resolved - comfortably past ground.maxLifeS, so any ball still
    // physically on a court is catchable, and a stale/replayed catch
    // message can't refund an ancient throw
    windowS: 20,
  },

  // ── Lobby limits (server-enforced) ────────────────────────────────
  lobby: {
    maxPlayers: 8, //      DECIDE default: small worlds; overflow is rejected
    snapshotIntervalS: 5,
    historyKept: 50, //    wall lines persisted + replayed to late joiners
  },
} as const;
