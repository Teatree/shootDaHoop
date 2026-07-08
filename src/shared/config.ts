// ════════════════════════════════════════════════════════════════════
//  SHARED BALANCE — the single config surface for everything that the
//  SIMULATION and RULES depend on: court geometry, hoop, throw physics,
//  scoring, walls, movement limits, throw budget. Imported by BOTH the
//  client and the (future) server — so it must stay dependency-free:
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
    rimHeightM: 5.55, //     regulation 3.05 + 2.5 (80 px) — sky hoop
    rimRadiusM: 0.69, //     rim opening half-width (scaled with the 3× ball)
    boardGapM: 0.25, //      gap between back rim and backboard face
    boardBottomM: 5.1, //    backboard vertical extent (tracks the raised rim)
    boardTopM: 8.0,
    rimRestitution: 0.55, // bounciness off the rim (let it rattle)
    boardRestitution: 0.65,
    laneDepthM: 0.45, //     |d − rim lane| where the ball interacts with the hoop
    scoreDepthM: 0.3, //     tighter depth window to actually count the bucket
  },

  // ── Boundary walls — physical scene edges past both baselines ─────
  wall: {
    offsetPx: 300, //      distance past each baseline, world px
    restitution: 0.6, //   horizontal energy kept when the ball hits a wall
  },

  // ── Movement ──────────────────────────────────────────────────────
  move: {
    speedM: 4.5, //          walk speed, m/s
    minXM: 0.4, //           left clamp (far baseline — one court length from hoop)
    hoopStandoffM: 6.25, //  keep-out radius around the hoop (200 world px)
    arriveEps: 0.08, //      "close enough" to the click target, m
  },

  // ── Ball flight & physics ─────────────────────────────────────────
  throw: {
    gravityM: 13.0, //       m/s² downward. Lower = floatier (real = 9.8)
    releaseHeightM: 2.2, //  hands-above-head release point (clears the big ball)
    releaseForwardM: 0.5, // ball spawns this far toward the hoop
    depthEaseRate: 2.2, //   how fast depth converges on the rim lane (1/s)
    spinRadPerM: 2.6, //     ball spin ∝ horizontal speed
    // the active ball type's size — ball types are data (see balls.ts)
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

  // ── Scoring ───────────────────────────────────────────────────────
  score: {
    insidePts: 100, //       inside the 3pt line
    threePts: 250, //        at the line
    perMeterPts: 10, //      per meter beyond the line
    capPts: 500, //          hard limit
    bigScorePts: 300, //     per-shot points above this = rainbow log + big juice
    slamPts: 500, //         a made basket while teleport-levitating
  },

  // ── Throw budget (server-authoritative; local play is unlimited) ──
  budget: {
    throwsPerDay: 5,
  },

  // ── Lobby limits (server-enforced) ────────────────────────────────
  lobby: {
    maxPlayers: 8, //      DECIDE default: small worlds; overflow is rejected
    snapshotIntervalS: 5,
    historyKept: 50, //    wall lines persisted + replayed to late joiners
  },
} as const;
