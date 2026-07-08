// ════════════════════════════════════════════════════════════════════
//  TUNING — every feel knob in the prototype lives in this file.
//  Edit + save → Vite hot-reloads. Expect to spend most time here.
//  Units: meters (m), seconds (s), meters/second (m/s) unless noted px.
// ════════════════════════════════════════════════════════════════════

export const T = {
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

  // ── Hoop geometry & materials ─────────────────────────────────────
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
  // (NOT the log wall: the log panel is a screen-space DOM element.)
  wall: {
    offsetPx: 300, //      distance past each baseline, world px
    restitution: 0.6, //   horizontal energy kept when the ball hits a wall
  },

  // ── Movement ──────────────────────────────────────────────────────
  move: {
    speedM: 4.5, //          walk speed, m/s
    minXM: 0.4, //           left clamp (far baseline — one court length from hoop)
    hoopStandoffM: 6.25, //  keep-out radius around the hoop (200 world px)
    zoneShowDistPx: 20, //   keep-out visual fades in this close to its line
    zoneFadeLerp: 6, //      fade in/out speed (1/s)
    arriveEps: 0.08, //      "close enough" to the click target, m
  },

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
    powerExponent: 1.8, //   >1 = fine control at the low end (eased, non-linear)
    minPowerM: 3.0, //       launch speed at the softest throw
    maxPowerM: 19.0, //      launch speed at full aim (enough for full-court)
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

  // ── Ball flight & physics ─────────────────────────────────────────
  throw: {
    gravityM: 13.0, //       m/s² downward. Lower = floatier (real = 9.8)
    releaseHeightM: 2.2, //  hands-above-head release point (clears the big ball)
    releaseForwardM: 0.5, // ball spawns this far toward the hoop
    depthEaseRate: 2.2, //   how fast depth converges on the rim lane (1/s)
    spinRadPerM: 2.6, //     ball spin ∝ horizontal speed
    ballRadiusM: 0.36, //    3× the real ball — reads as a basketball, not a baseball
    substepTravelFrac: 0.5, // max travel per physics substep, in ball radii (CCD-ish)
    maxSubsteps: 10,
    releasePopScale: 1.45, //scale "pop" on release
    releasePopMs: 140,
    trail: {
      lifespanMs: 260,
      frequencyMs: 24,
      alpha: 0.45,
    },
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

  // ── Teleport orb power-up ──────────────────────────────────────────
  tp: {
    cadenceS: 5, //          seconds after one orb ends before the next appears
    lifeS: 5, //             how long an orb stays before fading out
    radiusM: 0.55, //        orb size (hit when ball center is within r+ballR)
    aboveHoopPx: 100, //     spawn height: rim top + this…
    rangeHPx: 50, //         …plus 0..this, randomly
    rangeXPx: 100, //        spawn x: 0..this px left of the keep-out line
    popMs: 220, //           appear animation
    fadeMs: 400, //          disappear animation
    pulseHz: 1.4, //         idle pulse speed
    levitateS: 3, //         suspended this long after teleporting
    sinkSpeedM: 0.35, //     slow descent while levitating, m/s
    lieS: 5, //              face-down time after landing
    getUpMs: 350, //         stand-back-up animation
    weakThrowVh: 4.5, //     auto-throw (straight up) if time runs out mid-aim
    slamPts: 500, //         a made basket while levitating
  },

  // ── Ghost records (click a log throw → replay it on the court) ────
  ghost: {
    preRollS: 2, //          recording starts this long before the throw
    postRollS: 3, //         and runs this long past the hit/miss
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
