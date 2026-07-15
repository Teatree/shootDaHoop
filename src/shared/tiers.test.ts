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
  interactivesForTier,
  nextTier,
  orbTimingForTier,
} from "./tierRules";

// The tier recipes are DATA — these tests pin the doc's exact numbers
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
    // the whole hoop scales — board extents track ×1.4
    expect(g.boardBottomM).toBeCloseTo(BALANCE.hoop.boardBottomM * 1.4, 10);
    expect(g.boardTopM).toBeCloseTo(BALANCE.hoop.boardTopM * 1.4, 10);
  });

  it("tier 3 stacks two rims, overall only +10% over tier 2", () => {
    const g = hoopGeometryForTier(3);
    expect(g.rims.map((r) => r.id)).toEqual(["upper", "lower"]);
    const [upper, lower] = g.rims;
    // owner 2026-07-15: the second (upper) hoop sits ONE FULL HOOP
    // TALLNESS higher — structure height topH, rim raised to 2×topH
    const topH = BALANCE.hoop.rimHeightM * 1.4 * 1.1;
    expect(upper.h).toBeCloseTo(topH * 2, 10);
    // the upper is the slimmer one, the lower the wider one
    expect(upper.r).toBeLessThan(lower.r);
    // lower keeps the tier-2 rim width
    expect(lower.r).toBeCloseTo(hoopGeometryForTier(2).rims[0].r, 10);
  });

  it("tier 3's raised rim does NOT move the hoop wall (the backboard)", () => {
    const g = hoopGeometryForTier(3);
    const topH = BALANCE.hoop.rimHeightM * 1.4 * 1.1;
    const k = 1.4 * 1.1; // the structure's cumulative height scale
    // board extents stay pinned to the UNRAISED structure height
    expect(g.boardTopM).toBeCloseTo(
      topH + (BALANCE.hoop.boardTopM - BALANCE.hoop.rimHeightM) * k,
      10,
    );
    expect(g.boardTopM).toBeLessThan(g.rims[0].h); // rim above the wall
  });

  it("tier 3 upper rim protrudes exactly 20 px further left", () => {
    const [upper, lower] = hoopGeometryForTier(3).rims;
    const upperFront = upper.x - upper.r;
    const lowerFront = lower.x - lower.r;
    expect(lowerFront - upperFront).toBeCloseTo(20 / BALANCE.court.meterPx, 10);
  });

  it("tier 3 rim gap clears the ball so each rim is hit independently", () => {
    const [upper, lower] = hoopGeometryForTier(3).rims;
    expect(upper.h - lower.h).toBeGreaterThan(ball * 2 * 1.5);
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

  it("tier 1 has no hoop choreography", () => {
    expect(hoopChoreoGeometries(1)).toEqual([]);
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
});

describe("looks", () => {
  it("ball: classic until the tier-2 permanent effect turns it red", () => {
    expect(ballLookForTier(1)).toBe("classic");
    expect(ballLookForTier(2)).toBe("red");
    expect(ballLookForTier(3)).toBe("red");
  });

  it("court floor: standard → mahogany → glass", () => {
    expect(courtLookForTier(1)).toBe("standard");
    expect(courtLookForTier(2)).toBe("mahogany");
    expect(courtLookForTier(3)).toBe("glass");
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

  it("tier 3 hoop: dark red board/pole, pink-magenta rims (owner 2026-07-15)", () => {
    const t3 = hoopLookForTier(3);
    const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
    for (const part of [t3.board, t3.pole]) {
      const [r, g, b] = rgb(part);
      expect(r).toBeGreaterThan(g * 2); // dark RED, not gray
      expect(r).toBeGreaterThan(b * 2);
      expect(r).toBeLessThan(0xa0); //    dark, not bright
    }
    const [r, g, b] = rgb(t3.rim); // pink/magenta: strong red + blue, weak green
    expect(r).toBeGreaterThan(0xc0);
    expect(b).toBeGreaterThan(g);
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

  it("tier 3: smaller, very light blue, slower suns", () => {
    const a = atmosphereForTier(3);
    expect(a.overlay.alpha).toBeGreaterThan(0);
    expect(a.sun.sizeScale).toBeLessThan(1); //  smaller
    expect(a.sun.speedScale).toBeLessThan(1); // slower
    expect(a.sun.pulsate).toBe(false);
    expect(a.sun.coreColor & 0xff).toBeGreaterThan(0xd0); // strongly blue
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
  it("tiers 1–2 keep today's fixed cadence", () => {
    for (const id of [1, 2]) {
      const o = orbTimingForTier(id);
      expect(o.minCadenceS).toBe(BALANCE.orb.cadenceS);
      expect(o.maxCadenceS).toBe(BALANCE.orb.cadenceS);
      expect(o.lifeS).toBe(BALANCE.orb.lifeS);
      expect(o.appearFx).toBe("pop");
    }
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
