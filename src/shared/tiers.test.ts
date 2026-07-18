import { describe, expect, it } from "vitest";
import { BALANCE } from "./config";
import { RIM } from "./court";
import { HOOP_TIERS } from "./tiers";
import {
  animationsForTier,
  atmosphereForTier,
  ballLookForTier,
  BASE_ATMOSPHERE,
  canUpgrade,
  courtLookForTier,
  effectivePowerForTier,
  hoopChoreoGeometries,
  hoopGeometryForTier,
  hoopLookForTier,
  hoopMotionForTier,
  interactivesForTier,
  nextTier,
  orbTimingForTier,
  scaledThreshold,
  thresholdScale,
} from "./tierRules";

// The tier recipes are DATA - these tests pin the doc's exact numbers
// (HOOP_PROGRESSION.md) so a recipe edit that breaks a spec value fails
// loudly, and the geometry fold that physics/render/camera all share
// stays deterministic.

describe("tier recipes (well-formedness)", () => {
  it("ids are sequential from 1", () => {
    HOOP_TIERS.forEach((t, i) => expect(t.id).toBe(i + 1));
  });

  it("tier 1 is the starting state: no threshold, no changes", () => {
    expect(HOOP_TIERS[0].threshold).toBe(0);
    expect(HOOP_TIERS[0].changes).toHaveLength(0);
  });

  it("every later tier has a positive threshold above the previous", () => {
    for (const t of HOOP_TIERS.slice(1)) expect(t.threshold).toBeGreaterThan(0);
  });
});

describe("hoopGeometryForTier", () => {
  const ball = BALANCE.throw.ballRadiusM;

  it("tier 1 reproduces today's hoop exactly", () => {
    const g = hoopGeometryForTier(1);
    expect(g.rims).toHaveLength(1);
    expect(g.rims[0]).toEqual({ id: "main", x: RIM.x, h: RIM.h, r: RIM.r });
    expect(g.boardX).toBeCloseTo(RIM.x + RIM.r + BALANCE.hoop.boardGapM, 10);
    expect(g.boardBottomM).toBeCloseTo(BALANCE.hoop.boardBottomM, 10);
    expect(g.boardTopM).toBeCloseTo(BALANCE.hoop.boardTopM, 10);
  });

  it("tier 2 is +40% taller with a +15% wider rim", () => {
    const g = hoopGeometryForTier(2);
    expect(g.rims).toHaveLength(1);
    expect(g.rims[0].h).toBeCloseTo(BALANCE.hoop.rimHeightM * 1.4, 10);
    expect(g.rims[0].r).toBeCloseTo(BALANCE.hoop.rimRadiusM * 1.15, 10);
    // the whole hoop scales - board extents track ×1.4
    expect(g.boardBottomM).toBeCloseTo(BALANCE.hoop.boardBottomM * 1.4, 10);
    expect(g.boardTopM).toBeCloseTo(BALANCE.hoop.boardTopM * 1.4, 10);
  });

  it("tier 3 stacks two rims, overall only +10% over tier 2", () => {
    const g = hoopGeometryForTier(3);
    expect(g.rims.map((r) => r.id)).toEqual(["upper", "lower"]);
    const [upper, lower] = g.rims;
    // owner 2026-07-15 (revised down from "1 full hoop height"): the
    // second (upper) hoop sits exactly 2 rim-with-net heights above the
    // LOWER rim - one unit = the rim stroke (5 px) + the hanging net (2×r)
    const rimNetM = 5 / BALANCE.court.meterPx + 2 * lower.r;
    expect(upper.h).toBeCloseTo(lower.h + 2 * rimNetM, 10);
    // the upper is now the (slightly) WIDER one - owner 2026-07-17: at
    // rScale 0.8 its opening left +-0.275 m for the ball's center ten
    // meters up and a human could never register it; 1.1 keeps it the
    // harder rim by height while making it honestly hittable
    expect(upper.r).toBeCloseTo(lower.r * 1.1, 10);
    // a regression guard on the invariant that actually matters: the
    // CENTER window (r - ballR) must be a decent multiple of the ball
    expect(upper.r - BALANCE.throw.ballRadiusM).toBeGreaterThan(
      BALANCE.throw.ballRadiusM,
    );
    // lower keeps the tier-2 rim width
    expect(lower.r).toBeCloseTo(hoopGeometryForTier(2).rims[0].r, 10);
  });

  it("tier 3's raised rim does NOT move the hoop wall (the backboard)", () => {
    const g = hoopGeometryForTier(3);
    const topH = BALANCE.hoop.rimHeightM * 1.4 * 1.1;
    const k = 1.4 * 1.1; // the structure's cumulative height scale
    // board extents stay pinned to the UNRAISED structure height,
    // whatever the upper rim's raise is
    expect(g.boardTopM).toBeCloseTo(
      topH + (BALANCE.hoop.boardTopM - BALANCE.hoop.rimHeightM) * k,
      10,
    );
  });

  it("tier 3 upper rim protrudes exactly 30 px further left (owner 2026-07-19)", () => {
    const [upper, lower] = hoopGeometryForTier(3).rims;
    const upperFront = upper.x - upper.r;
    const lowerFront = lower.x - lower.r;
    expect(lowerFront - upperFront).toBeCloseTo(30 / BALANCE.court.meterPx, 10);
  });

  it("tier 3 rim gap clears the ball so each rim is hit independently", () => {
    const [upper, lower] = hoopGeometryForTier(3).rims;
    expect(upper.h - lower.h).toBeGreaterThan(ball * 2 * 1.5);
  });

  it("tier 4 is back to ONE rim: 20% wider, same structure height", () => {
    const g = hoopGeometryForTier(4);
    expect(g.rims).toHaveLength(1);
    expect(g.rims[0].id).toBe("main");
    // no heightScale on the tier-4 change: the structure keeps 1.4 * 1.1
    expect(g.rims[0].h).toBeCloseTo(BALANCE.hoop.rimHeightM * 1.4 * 1.1, 10);
    // the rim folds 1.15 (tier 2) * 1.2 (tier 4) over the base width
    expect(g.rims[0].r).toBeCloseTo(BALANCE.hoop.rimRadiusM * 1.15 * 1.2, 10);
  });

  it("the board always sits behind the back-most rim", () => {
    for (const t of HOOP_TIERS) {
      const g = hoopGeometryForTier(t.id);
      for (const rim of g.rims)
        expect(g.boardX).toBeGreaterThanOrEqual(rim.x + rim.r);
    }
  });
});

describe("hoopChoreoGeometries (the upgrade animation's staged looks)", () => {
  it("tier 2: taller FIRST (old rim width), then the rim widens", () => {
    const stages = hoopChoreoGeometries(2);
    expect(stages).toHaveLength(3); // grow-taller, wait, widen-rim
    const [tall, wait, wide] = stages;
    expect(tall.rims[0].h).toBeCloseTo(BALANCE.hoop.rimHeightM * 1.4, 10);
    expect(tall.rims[0].r).toBeCloseTo(BALANCE.hoop.rimRadiusM, 10); // old width
    expect(wait).toEqual(tall); // the 1-second pause holds the look
    expect(wide).toEqual(hoopGeometryForTier(2)); // ends at the full tier
  });

  it("tier 3: taller → upper juts forward alone → lower appears beneath", () => {
    const stages = hoopChoreoGeometries(3);
    expect(stages).toHaveLength(4);
    const [tall, jut, wait, full] = stages;
    const t3 = hoopGeometryForTier(3);
    // beat 1: still a single tier-2-width rim, at the +10% STRUCTURE
    // height (the raise belongs to the upper rim, which juts in beat 2)
    expect(tall.rims).toHaveLength(1);
    expect(tall.rims[0].h).toBeCloseTo(BALANCE.hoop.rimHeightM * 1.4 * 1.1, 10);
    expect(tall.rims[0].r).toBeCloseTo(hoopGeometryForTier(2).rims[0].r, 10);
    // beat 2: the upper rim alone, slimmer + protruded
    expect(jut.rims).toHaveLength(1);
    expect(jut.rims[0]).toEqual(t3.rims[0]);
    expect(wait).toEqual(jut);
    // final beat: the full double hoop
    expect(full).toEqual(t3);
  });

  it("tier 4: the double collapses to one → rim widens → starts moving", () => {
    const stages = hoopChoreoGeometries(4);
    expect(stages).toHaveLength(4); // collapse, wait, widen, start-moving
    const [collapsed, wait, wide, moving] = stages;
    const t4 = hoopGeometryForTier(4);
    // beat 1: ONE rim again, still at the tier-3 fold's width
    expect(collapsed.rims).toHaveLength(1);
    expect(collapsed.rims[0].r).toBeCloseTo(
      BALANCE.hoop.rimRadiusM * 1.15,
      10,
    );
    expect(wait).toEqual(collapsed);
    // beat 3: the rim widens to the full tier-4 opening
    expect(wide).toEqual(t4);
    // the start-moving cue changes no geometry - it flips the carriage on
    expect(moving).toEqual(t4);
  });

  it("tier 1 has no hoop choreography", () => {
    expect(hoopChoreoGeometries(1)).toEqual([]);
  });
});

describe("hoopMotionForTier (the Hoop 4 moving hoop)", () => {
  it("hoops stand still through tier 3", () => {
    for (const id of [1, 2, 3]) expect(hoopMotionForTier(id)).toBeNull();
  });

  it("tier 4 rides slowly with 2-4 s dwells (owner spec 2026-07-18)", () => {
    const m = hoopMotionForTier(4)!;
    expect(m).not.toBeNull();
    expect(m.dwellMinS).toBe(2);
    expect(m.dwellMaxS).toBe(4);
    expect(m.travelM).toBeGreaterThan(0);
    // "moves slowly": under a meter per second on average
    expect(m.travelM / m.travelS).toBeLessThan(1);
  });
});

describe("effectivePowerForTier (+25% ball travel)", () => {
  it("tier 1 is the base curve", () => {
    expect(effectivePowerForTier(1)).toEqual({
      minPowerM: BALANCE.power.minPowerM,
      maxPowerM: BALANCE.power.maxPowerM,
    });
  });

  it("tier 2 scales launch speed by √1.25 (range ∝ v²)", () => {
    const p = effectivePowerForTier(2);
    expect(p.maxPowerM).toBeCloseTo(BALANCE.power.maxPowerM * Math.sqrt(1.25), 10);
    expect(p.minPowerM).toBeCloseTo(BALANCE.power.minPowerM * Math.sqrt(1.25), 10);
  });

  it("tier 3 adds no further range", () => {
    expect(effectivePowerForTier(3)).toEqual(effectivePowerForTier(2));
  });

  it("tier 4 stacks another +25% travel: speed folds to √(1.25 * 1.25)", () => {
    const p = effectivePowerForTier(4);
    expect(p.maxPowerM).toBeCloseTo(BALANCE.power.maxPowerM * 1.25, 10);
    expect(p.minPowerM).toBeCloseTo(BALANCE.power.minPowerM * 1.25, 10);
  });
});

describe("looks", () => {
  it("ball: classic until the tier-2 permanent effect turns it red", () => {
    expect(ballLookForTier(1)).toBe("classic");
    expect(ballLookForTier(2)).toBe("red");
    expect(ballLookForTier(3)).toBe("red");
    expect(ballLookForTier(4)).toBe("pinkpurple");
  });

  it("court floor: standard → mahogany → glass → white", () => {
    expect(courtLookForTier(1)).toBe("standard");
    expect(courtLookForTier(2)).toBe("mahogany");
    expect(courtLookForTier(3)).toBe("glass");
    expect(courtLookForTier(4)).toBe("white");
  });

  it("tier 4 hoop: light brown base/wall, BLACK rim (owner 2026-07-18)", () => {
    const t4 = hoopLookForTier(4);
    const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
    for (const part of [t4.board, t4.pole]) {
      const [r, g, b] = rgb(part);
      expect(r).toBeGreaterThan(g); // brown: warm...
      expect(g).toBeGreaterThan(b); // ...descending r > g > b
      expect(r).toBeGreaterThan(0x90); // LIGHT brown, not mahogany
    }
    const [r, g, b] = rgb(t4.rim);
    expect(Math.max(r, g, b)).toBeLessThan(0x30); // black rim
  });

  it("hoop paint: each hoop change repaints board/rim/pole", () => {
    const t1 = hoopLookForTier(1);
    const t2 = hoopLookForTier(2);
    const t3 = hoopLookForTier(3);
    expect(t1.rim).toBe(0xe86a3a); // today's orange
    expect(t2.rim).toBe(0x3a76c4); // owner-specified: blue rim…
    expect(t2.board).toBe(0x4a4a52); // …dark gray board…
    expect(t2.pole).toBeLessThan(t1.pole); // …darker pole
    expect(t3).not.toEqual(t2); // tier 3 has its own paint job
  });

  it("tier 3 hoop: dark red board/pole, darker PURPLE rims (owner 2026-07-19)", () => {
    const t3 = hoopLookForTier(3);
    const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
    for (const part of [t3.board, t3.pole]) {
      const [r, g, b] = rgb(part);
      expect(r).toBeGreaterThan(g * 2); // dark RED, not gray
      expect(r).toBeGreaterThan(b * 2);
      expect(r).toBeLessThan(0xa0); //    dark, not bright
    }
    const [r, g, b] = rgb(t3.rim); // purple: blue leads red, weak green...
    expect(b).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeLessThan(0xc0); // ...and DARKER than the old pink
  });
});

describe("atmosphereForTier", () => {
  it("tier 1 is today's sky exactly: no wash, warm suns, base pace", () => {
    expect(atmosphereForTier(1)).toEqual(BASE_ATMOSPHERE);
    expect(BASE_ATMOSPHERE.overlay.alpha).toBe(0);
  });

  it("tier 2 washes the world red and sets the suns pulsating, redder", () => {
    const a = atmosphereForTier(2);
    expect(a.overlay.alpha).toBeGreaterThan(0);
    expect(a.overlay.alpha).toBeLessThan(0.2); // "very transparent"
    expect((a.overlay.color >> 16) & 0xff).toBeGreaterThan(0xc0); // red-led
    expect(a.sun.pulsate).toBe(true);
    expect(a.sun.sizeScale).toBe(1);
    expect(a.sun.speedScale).toBe(1);
  });

  it("tier 3: smaller, slower, BLUE suns that read on the gray sky", () => {
    const a = atmosphereForTier(3);
    expect(a.overlay.alpha).toBeGreaterThan(0);
    expect(a.sun.sizeScale).toBeLessThan(1); //  smaller
    expect(a.sun.speedScale).toBeLessThan(1); // slower
    expect(a.sun.pulsate).toBe(false);
    const [r, g, b] = [
      (a.sun.coreColor >> 16) & 0xff,
      (a.sun.coreColor >> 8) & 0xff,
      a.sun.coreColor & 0xff,
    ];
    expect(b).toBeGreaterThan(r); // still blueish…
    // …but clearly visible on the light-gray sky: darker than the sky
    // by a real margin (the old very-light-blue vanished into it)
    const sky = a.sky;
    const skyAvg = (((sky >> 16) & 0xff) + ((sky >> 8) & 0xff) + (sky & 0xff)) / 3;
    expect((r + g + b) / 3).toBeLessThan(skyAvg - 40);
  });

  it("tier 4: green-gray sky, one BIG bright-yellow sun at Hoop 1 pace", () => {
    const a = atmosphereForTier(4);
    const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
    // the sun: bright yellow (strong red + green, weak blue), BIGGER,
    // back at the base speed, steady
    const [r, g, b] = rgb(a.sun.coreColor);
    expect(r).toBeGreaterThan(0xe0);
    expect(g).toBeGreaterThan(0xb0);
    expect(b).toBeLessThan(0x60);
    expect(a.sun.sizeScale).toBeGreaterThan(1);
    expect(a.sun.speedScale).toBe(1);
    expect(a.sun.pulsate).toBe(false);
    // the sky: green-gray - green leads, and the channels sit close
    const [sr, sg, sb] = rgb(a.sky);
    expect(sg).toBeGreaterThanOrEqual(sr);
    expect(sg).toBeGreaterThan(sb);
    expect(Math.max(sr, sg, sb) - Math.min(sr, sg, sb)).toBeLessThan(0x28);
  });

  it("the sky: base cream through tier 2, LIGHT GRAY at tier 3, gradual", () => {
    expect(atmosphereForTier(1).sky).toBe(BASE_ATMOSPHERE.sky);
    expect(atmosphereForTier(2).sky).toBe(BASE_ATMOSPHERE.sky); // tier 2 keeps it
    const sky = atmosphereForTier(3).sky;
    const [r, g, b] = [(sky >> 16) & 0xff, (sky >> 8) & 0xff, sky & 0xff];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12); // gray…
    expect(Math.min(r, g, b)).toBeGreaterThan(0xb0); //               …light
    // and the recolour rides alongside the other sequences
    const atmo = HOOP_TIERS[2].changes.find((c) => c.type === "atmosphere");
    expect(atmo && "gradual" in atmo && atmo.gradual).toBe(true);
  });
});

describe("orbTimingForTier", () => {
  it("tiers 1-2 have NO orb at all (owner 2026-07-16: Hoop 3 only)", () => {
    expect(orbTimingForTier(1)).toBeNull();
    expect(orbTimingForTier(2)).toBeNull();
  });

  it("tier 3 switches to a 10–20 s random cadence, 5 s life, no pop", () => {
    expect(orbTimingForTier(3)).toEqual({
      minCadenceS: 10,
      maxCadenceS: 20,
      lifeS: 5,
      appearFx: "none",
    });
  });
});

describe("interactives & animations accumulate across tiers", () => {
  it("tier 2 adds the cheering area; tier 3 keeps it and adds the jukebox", () => {
    expect(interactivesForTier(1)).toHaveLength(0);
    expect(interactivesForTier(2).map((e) => e.element)).toEqual(["cheer-area"]);
    expect(interactivesForTier(3).map((e) => e.element)).toEqual([
      "cheer-area",
      "jukebox",
    ]);
  });

  it("the jukebox is synced-to-everyone; the cheer area occupies a spot", () => {
    const [cheer, jukebox] = interactivesForTier(3);
    expect(cheer.occupiesSpot).toBe(true);
    expect(cheer.spots).toBe(3);
    expect(jukebox.occupiesSpot).toBe(false);
    expect(jukebox.synced).toBe(true);
  });

  it("cheer unlocks at tier 2", () => {
    expect(animationsForTier(1).has("cheer")).toBe(false);
    expect(animationsForTier(2).has("cheer")).toBe(true);
  });
});

describe("canUpgrade / nextTier", () => {
  it("needs the next tier's threshold, counted from the reset", () => {
    const t2 = nextTier(1)!;
    expect(canUpgrade({ sharedScore: t2.threshold - 1, tierId: 1 })).toBe(false);
    expect(canUpgrade({ sharedScore: t2.threshold, tierId: 1 })).toBe(true);
  });

  it("no upgrade past the top of the ladder", () => {
    const top = HOOP_TIERS[HOOP_TIERS.length - 1].id;
    expect(nextTier(top)).toBeNull();
    expect(canUpgrade({ sharedScore: 999999, tierId: top })).toBe(false);
  });
});

// Lobby scaling (owner ask 2026-07-18): a court built for n players
// scales ONLY the tier thresholds - superlinearly, because a bigger
// crowd is likelier to hold a sharp shooter. 3 is the balance baseline.
describe("lobby scaling (thresholdScale / scaledThreshold)", () => {
  it("the baseline trio scales by exactly 1 - today's numbers", () => {
    expect(thresholdScale(3)).toBe(1);
    expect(thresholdScale(undefined)).toBe(1);
    for (const t of HOOP_TIERS)
      expect(scaledThreshold(t, undefined)).toBe(t.threshold);
  });

  it("grows superlinearly with the crowd", () => {
    expect(thresholdScale(2)).toBeCloseTo(0.6);
    expect(thresholdScale(4)).toBeCloseTo((4 / 3) * 1.1);
    expect(thresholdScale(5)).toBeCloseTo(2);
    // per-head requirement rises with n (the skill-odds premium)
    expect(thresholdScale(5) / 5).toBeGreaterThan(thresholdScale(2) / 2);
  });

  it("clamps wild inputs into the 2-5 slider range", () => {
    expect(thresholdScale(0)).toBe(thresholdScale(2));
    expect(thresholdScale(99)).toBe(thresholdScale(5));
    expect(thresholdScale(Number.NaN)).toBe(1);
  });

  it("rounds thresholds to a friendly 50", () => {
    for (const n of [2, 3, 4, 5])
      for (const t of HOOP_TIERS.slice(1))
        expect(scaledThreshold(t, n) % 50).toBe(0);
  });

  it("canUpgrade enforces the scaled threshold", () => {
    const t2 = nextTier(1)!;
    const duo = scaledThreshold(t2, 2); // 600 at today's numbers
    expect(duo).toBeLessThan(t2.threshold);
    expect(
      canUpgrade({ sharedScore: duo - 1, tierId: 1, expectedPlayers: 2 }),
    ).toBe(false);
    expect(
      canUpgrade({ sharedScore: duo, tierId: 1, expectedPlayers: 2 }),
    ).toBe(true);
    // the same score is NOT enough on a five-player court
    expect(
      canUpgrade({ sharedScore: duo, tierId: 1, expectedPlayers: 5 }),
    ).toBe(false);
  });
});
