// ════════════════════════════════════════════════════════════════════
//  TUNING — every CLIENT-SIDE feel knob lives in this file.
//  Edit + save → Vite hot-reloads. Expect to spend most time here.
//
//  The SHARED balance (court, hoop, physics, scoring, walls, movement,
//  throw budget — everything the server also needs) lives in
//  src/shared/config.ts and is spread into `T` below, so `T.court…`,
//  `T.throw…` etc. keep working everywhere on the client.
//  Units: meters (m), seconds (s), meters/second (m/s) unless noted px.
// ════════════════════════════════════════════════════════════════════

import { BALANCE } from "./shared/config";

export const T = {
  ...BALANCE,

  // ── Camera rig ────────────────────────────────────────────────────
  camera: {
    minVisibleWidthM: 14, // never zoom in tighter than this world width
    //                       (≈ right half of the court → the spawn framing)
    padXPx: 120, //          extra world-px around the {player, hoop} box
    padTopPx: 240, //        headroom above (arcs need sky)
    padBottomPx: 60,
    zoomMin: 0.2,
    zoomMax: 2.0,
    panLerp: 3.5, //         higher = snappier follow (exp smoothing rate, 1/s)
    zoomLerp: 2.5,
  },

  // ── Aiming (right-click hold: aim at the cursor, DRAG to charge) ──
  aim: {
    maxDragPx: 240, //       screen-px drag from the press point = full power
    deadzonePx: 10, //       drags shorter than this (screen px) cancel the throw
    powerExponent: BALANCE.power.powerExponent,
    minPowerM: BALANCE.power.minPowerM,
    maxPowerM: BALANCE.power.maxPowerM,
    // The preview line IS the power meter: longer + hotter = harder throw.
    previewMinLenM: 1.95, // arc length shown at the softest throw…
    previewMaxLenM: 6.3, //  …growing to this at full power
    previewDotSpacingM: 0.35,
    previewDotStartPx: 6, // dot size at the release point…
    previewDotEndPx: 1.5, //  …shrinking to this at the preview's end
    previewAlphaStart: 0.78, // dot alpha at the release point…
    previewAlphaEnd: 0.08, //  …dissipating to this (no hard cutoff)
    previewCapRingPx: 9, //  pulsing ring at the line's end when power = 100%
  },

  // ── Ball flight presentation (physics itself is shared) ──────────
  throwFx: {
    releasePopScale: 1.45, //scale "pop" on release
    releasePopMs: 140,
    trail: {
      lifespanMs: 260,
      frequencyMs: 24,
      alpha: 0.45,
    },
  },

  // ── Keep-out zone reveal ──────────────────────────────────────────
  zone: {
    showDistPx: 20, //       keep-out visual fades in this close to its line
    fadeLerp: 6, //          fade in/out speed (1/s)
  },

  // ── Sky: the sun procession over the desert ───────────────────────
  sky: {
    traverseMinS: 60, //     one sun-config crossing takes 60..120 s
    traverseMaxS: 120,
    gapS: 1.0, //            empty-sky pause between configs
    arcPeakPx: 320, //       arc apex height above the horizon, world px
    bigSunPx: 52, //         radii
    smallSunPx: 24,
    glowScale: 1.9, //       halo circle = radius × this
    glowAlpha: 0.22,
    companionOffsetX: 90, // small buddy sun, relative to the big one (px)
    companionOffsetY: -40,
    // dynamic drop shadows (player / hoop / ball)
    lightLerp: 1.2, //       shadows ease between suns at this rate (1/s), no jerk
    shadowSlope: 0.35, //    shadow x-offset px per px of caster height, low sun
    shadowAlphaHigh: 0.24, //sun overhead → tight, dark
    shadowAlphaLow: 0.1, //  sun at the horizon → long, faint
    shadowStretchMax: 1.7, //horizontal ellipse stretch at low sun
  },

  // ── Teleport orb power-up: client FEEL only ───────────────────────
  // The orb's gameplay rules (cadence, lifetime, size, spawn zone,
  // levitation window) are server-authoritative — see BALANCE.orb.
  tp: {
    popMs: 220, //           appear animation
    fadeMs: 400, //          disappear animation
    pulseHz: 1.4, //         idle pulse speed
    sinkSpeedM: 0.35, //     slow descent while levitating, m/s
    lieS: 5, //              face-down time after landing
    getUpMs: 350, //         stand-back-up animation
    weakThrowVh: 4.5, //     auto-throw (straight up) if time runs out mid-aim
  },

  // ── Ghost records (click a log throw → replay it on the court) ────
  ghost: {
    preRollS: 2, //          recording starts this long before the throw
    slamPreRollS: 4, //      …but slams start this long before the ORB HIT
    postRollS: 2, //         and runs this long past the hit/miss
    alpha: 0.5, //           ghost transparency
    popMs: 220, //           ghost appear animation
    fadeMs: 450, //          ghost disappear fade
    maxStored: 25, //        oldest recordings beyond this are dropped
  },

  // ── Speech bubbles (chat above the player) ────────────────────────
  speech: {
    holdS: 5, //             how long a bubble hangs before fading
    appearMs: 200, //        pop-in tween
    fadeMs: 350, //          fade-out tween
    wrapPx: 220, //          text wraps at this width; bubble sizes to fit
    padPx: 8, //             bubble padding around the text
    gapAbovePx: 88, //       bubble tail height above the player's feet
    bobPx: 2.5, //           idle hang: gentle vertical bob…
    bobHz: 0.7, //           …at this frequency
    swayRad: 0.012, //       …with a tiny rotation sway
    maxChars: 1000,
  },

  // ── Juice (score effects, explode, shake) ─────────────────────────
  juice: {
    scoreShakeMs: 180,
    scoreShakeIntensity: 0.006,
    swishShakeMs: 260,
    swishShakeIntensity: 0.011,
    scoreParticles: 26,
    swishParticles: 60,
    netSnapMs: 380,
    explodeParticles: 22,
    floatTextRisePx: 46,
    floatTextMs: 900,
    big: {
      //                     shots worth > score.bigScorePts
      particleMult: 2.5, //  × the usual burst count
      shakeMs: 550,
      shakeIntensity: 0.022,
      flashRadius: 64,
      floatSizePx: 32,
      floatColor: "#ff5ad0",
    },
  },
} as const;
