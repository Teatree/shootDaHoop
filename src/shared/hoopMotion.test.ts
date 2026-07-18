import { describe, expect, it } from "vitest";
import {
  clampLaunchStamp,
  hoopGeometryAt,
  motionLiftAt,
  type HoopMotionState,
} from "./hoopMotion";
import { hoopGeometryForTier, hoopMotionForTier } from "./tierRules";
import type { HoopMotionSpec } from "./tierChanges";

// The moving hoop's clock is a PURE FOLD over epoch time: one
// {seed, anchorMs} makes every screen, the server and any restart agree
// on where the carriage is. These tests pin that determinism plus the
// owner spec: gradual travel, random 2-4 s dwells at each end.

const spec: HoopMotionSpec = {
  travelM: 1.2,
  travelS: 2.4,
  dwellMinS: 2,
  dwellMaxS: 4,
};
const state: HoopMotionState = { seed: 0xc0ffee, anchorMs: 1_000_000 };

describe("motionLiftAt", () => {
  it("sits at the low stop at and before the anchor", () => {
    expect(motionLiftAt(spec, state, state.anchorMs)).toBe(0);
    expect(motionLiftAt(spec, state, state.anchorMs - 5000)).toBe(0);
  });

  it("stays within [0, travelM] over a long stretch", () => {
    for (let s = 0; s < 600; s += 0.21) {
      const lift = motionLiftAt(spec, state, state.anchorMs + s * 1000);
      expect(lift).toBeGreaterThanOrEqual(0);
      expect(lift).toBeLessThanOrEqual(spec.travelM);
    }
  });

  it("visits BOTH stops (it actually oscillates)", () => {
    let sawLow = false;
    let sawHigh = false;
    for (let s = 0; s < 120; s += 0.1) {
      const lift = motionLiftAt(spec, state, state.anchorMs + s * 1000);
      if (lift === 0) sawLow = true;
      if (lift === spec.travelM) sawHigh = true;
    }
    expect(sawLow).toBe(true);
    expect(sawHigh).toBe(true);
  });

  it("is deterministic: warm cursor and out-of-order queries agree", () => {
    // warm the cursor with a forward sweep...
    const times: number[] = [];
    for (let s = 0; s < 60; s += 0.37) times.push(state.anchorMs + s * 1000);
    const warm = times.map((t) => motionLiftAt(spec, state, t));
    // ...then query the SAME instants backwards (each restarts the walk)
    const cold: number[] = [];
    for (const t of [...times].reverse())
      cold.unshift(motionLiftAt(spec, state, t));
    expect(cold).toEqual(warm);
  });

  it("dwells hold each stop between dwellMinS and dwellMaxS", () => {
    // measure the length of every full stop-hold in the first minutes
    const dtS = 0.01;
    const holds: number[] = [];
    let holdS = 0;
    let prevAtStop = true; // starts at the low stop
    for (let s = dtS; s < 240; s += dtS) {
      const lift = motionLiftAt(spec, state, state.anchorMs + s * 1000);
      const atStop = lift === 0 || lift === spec.travelM;
      if (atStop) holdS += dtS;
      else {
        if (prevAtStop && holdS > 0) holds.push(holdS);
        holdS = 0;
      }
      prevAtStop = atStop;
    }
    expect(holds.length).toBeGreaterThan(10);
    // the FIRST hold started at the anchor mid-dwell only if s=0 counts;
    // sampling starts at dtS so every recorded hold is a full dwell
    for (const h of holds) {
      expect(h).toBeGreaterThanOrEqual(spec.dwellMinS - dtS * 2);
      expect(h).toBeLessThanOrEqual(spec.dwellMaxS + dtS * 2);
    }
  });

  it("travel legs are monotonic and take travelS (the smoothstep ease)", () => {
    // find a rise: first instant lift leaves 0
    let riseStartS = 0;
    for (let s = 0; s < 30; s += 0.001) {
      if (motionLiftAt(spec, state, state.anchorMs + s * 1000) > 0) {
        riseStartS = s;
        break;
      }
    }
    expect(riseStartS).toBeGreaterThan(0);
    let prev = 0;
    for (let f = 0.001; f <= 1; f += 0.02) {
      const lift = motionLiftAt(
        spec,
        state,
        state.anchorMs + (riseStartS - 0.001 + f * spec.travelS) * 1000,
      );
      expect(lift).toBeGreaterThanOrEqual(prev); // monotonic rise
      prev = lift;
    }
    // the leg lands at the top after travelS
    expect(
      motionLiftAt(
        spec,
        state,
        state.anchorMs + (riseStartS + spec.travelS) * 1000,
      ),
    ).toBeCloseTo(spec.travelM, 5);
  });

  it("different seeds give different dwell schedules", () => {
    const other: HoopMotionState = { seed: 0xbeef, anchorMs: state.anchorMs };
    let differs = false;
    for (let s = 0; s < 120 && !differs; s += 0.1) {
      const a = motionLiftAt(spec, state, state.anchorMs + s * 1000);
      const b = motionLiftAt(spec, other, state.anchorMs + s * 1000);
      if (Math.abs(a - b) > 1e-9) differs = true;
    }
    expect(differs).toBe(true);
  });
});

describe("hoopGeometryAt", () => {
  it("still tiers (1-3) and missing schedules return the static geometry", () => {
    for (const id of [1, 2, 3]) {
      expect(hoopGeometryAt(id, state, state.anchorMs + 12345)).toBe(
        hoopGeometryForTier(id),
      );
    }
    expect(hoopGeometryAt(4, null, state.anchorMs)).toBe(
      hoopGeometryForTier(4),
    );
  });

  it("lifts rims AND board together, pole plane untouched, cache unpoisoned", () => {
    const spec4 = hoopMotionForTier(4)!;
    const base = hoopGeometryForTier(4);
    const baseRimH = base.rims[0].h;
    const baseTop = base.boardTopM;
    // find an instant mid-rise
    let atMs = state.anchorMs;
    for (let s = 0; s < 30; s += 0.05) {
      const lift = motionLiftAt(spec4, state, state.anchorMs + s * 1000);
      if (lift > 0.1 && lift < spec4.travelM - 0.1) {
        atMs = state.anchorMs + s * 1000;
        break;
      }
    }
    const lifted = hoopGeometryAt(4, state, atMs);
    const lift = lifted.rims[0].h - baseRimH;
    expect(lift).toBeGreaterThan(0);
    // the wall rides with the rim (owner: "the wall moves together")
    expect(lifted.boardTopM - baseTop).toBeCloseTo(lift, 10);
    expect(lifted.boardBottomM - base.boardBottomM).toBeCloseTo(lift, 10);
    expect(lifted.boardX).toBe(base.boardX); // no sideways drift
    // and the static cache was NOT mutated
    expect(hoopGeometryForTier(4).rims[0].h).toBe(baseRimH);
    expect(hoopGeometryForTier(4).boardTopM).toBe(baseTop);
  });
});

describe("clampLaunchStamp", () => {
  const now = 5_000_000;

  it("passes stamps inside the window through verbatim", () => {
    expect(clampLaunchStamp(now - 1000, now)).toBe(now - 1000);
    expect(clampLaunchStamp(now + 200, now)).toBe(now + 200);
  });

  it("clamps stale/future stamps to the window edges", () => {
    expect(clampLaunchStamp(now - 60_000, now)).toBe(now - 2500);
    expect(clampLaunchStamp(now + 60_000, now)).toBe(now + 500);
  });

  it("falls back to now on absent or garbage stamps", () => {
    expect(clampLaunchStamp(undefined, now)).toBe(now);
    expect(clampLaunchStamp(Number.NaN, now)).toBe(now);
  });
});
