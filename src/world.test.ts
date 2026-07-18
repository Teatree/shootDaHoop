import { describe, expect, it } from "vitest";
import { T } from "./tuning";
import { rollSpawn } from "./shared/court";
import {
  M,
  RIM,
  WALL_LEFT_X,
  WALL_RIGHT_X,
  clamp,
  clampToCourt,
  floorDistToRim,
  floorY,
  screenToFloor,
  toScreen,
} from "./world";

describe("coordinate mapping", () => {
  it("maps meters to world px at the tuned scale", () => {
    expect(toScreen(1, 0, 0)).toEqual({ sx: M, sy: T.court.floorBaseY });
  });

  it("depth pushes the floor line down, height lifts off it", () => {
    expect(floorY(T.court.depthM)).toBe(
      T.court.floorBaseY + T.court.depthM * T.court.depthPxPerM,
    );
    expect(toScreen(0, 0, 2).sy).toBe(T.court.floorBaseY - 2 * M);
  });

  it("screenToFloor inverts toScreen on the floor plane", () => {
    const { sx, sy } = toScreen(10, 4, 0);
    const back = screenToFloor(sx, sy);
    expect(back.x).toBeCloseTo(10, 10);
    expect(back.d).toBeCloseTo(4, 10);
  });
});

describe("court clamps", () => {
  it("keeps the player outside the hoop keep-out zone", () => {
    expect(clampToCourt(26, RIM.d).x).toBeCloseTo(
      RIM.x - T.move.hoopStandoffM,
      10,
    );
  });

  it("clamps to the left baseline and the depth band", () => {
    expect(clampToCourt(-5, RIM.d).x).toBe(T.move.minXM);
    expect(clampToCourt(10, -1).d).toBe(0);
    expect(clampToCourt(10, 99).d).toBe(T.court.depthM);
  });

  it("clamp() is a plain min/max clamp", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("rollSpawn lands in the spawn square beside the keep-out zone", () => {
    const zoneEdge = RIM.x - T.move.hoopStandoffM;
    for (const r of [0, 0.3, 0.7, 0.999]) {
      const s = rollSpawn(() => r);
      expect(s.x).toBeLessThanOrEqual(zoneEdge);
      expect(s.x).toBeGreaterThanOrEqual(zoneEdge - T.move.spawnAreaM);
      expect(s.d).toBeGreaterThanOrEqual(0);
      expect(s.d).toBeLessThanOrEqual(T.court.depthM);
      expect(Math.abs(s.d - RIM.d)).toBeLessThanOrEqual(T.move.spawnAreaM / 2);
    }
  });
});

describe("landmarks", () => {
  it("distance to rim combines court length and depth", () => {
    expect(floorDistToRim(RIM.x, RIM.d)).toBe(0);
    expect(floorDistToRim(RIM.x - 3, RIM.d)).toBeCloseTo(3, 10);
    expect(floorDistToRim(RIM.x, RIM.d - 3)).toBeCloseTo(3, 10);
  });

  it("boundary walls sit offsetPx past both baselines", () => {
    // the left wall follows the SHORTENED left baseline (owner 2026-07-19)
    expect(WALL_LEFT_X).toBeCloseTo(T.court.leftEdgeM - T.wall.offsetPx / M, 10);
    expect(WALL_RIGHT_X).toBeCloseTo(T.court.lengthM + T.wall.offsetPx / M, 10);
  });

  it("the court's left edge is 220 px left of the ORIGINAL center", () => {
    expect(T.court.leftEdgeM).toBeCloseTo(T.court.lengthM / 2 - 220 / M, 10);
    // ...which lands the floor at ~75% of its original length
    expect(
      (T.court.lengthM - T.court.leftEdgeM) / T.court.lengthM,
    ).toBeCloseTo(0.75, 1);
    // the playable clamp keeps its margin off the new baseline
    expect(T.move.minXM).toBeCloseTo(T.court.leftEdgeM + 0.4, 10);
  });
});
