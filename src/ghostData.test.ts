import { describe, expect, it } from "vitest";
import {
  lerpBall,
  lerpFrame,
  sampleAt,
  type BallSample,
  type FrameSample,
} from "./ghostData";

const b = (t: number, x: number): BallSample => ({ t, x, d: 3, h: 1 });

const f = (t: number, x: number, extra?: Partial<FrameSample>): FrameSample => ({
  t,
  x,
  d: 3,
  airH: 0,
  facing: 1,
  angle: 0,
  pose: { kind: "idle", t: 0 },
  orb: null,
  bubble: null,
  ...extra,
});

describe("sampleAt", () => {
  it("returns null before the first sample and on empty arrays", () => {
    expect(sampleAt([], 1, lerpBall)).toBeNull();
    expect(sampleAt([b(1, 0)], 0.5, lerpBall)).toBeNull();
  });

  it("clamps to the last sample after the recording's end", () => {
    const arr = [b(0, 0), b(1, 10)];
    expect(sampleAt(arr, 99, lerpBall)).toBe(arr[1]);
  });

  it("linearly interpolates between neighbours", () => {
    const arr = [b(0, 0), b(1, 10)];
    expect(sampleAt(arr, 0.25, lerpBall)!.x).toBeCloseTo(2.5, 10);
    expect(sampleAt(arr, 0.5, lerpBall)!.x).toBeCloseTo(5, 10);
  });

  it("survives duplicate timestamps", () => {
    const arr = [b(0, 0), b(0.5, 4), b(0.5, 4), b(1, 10)];
    expect(sampleAt(arr, 0.5, lerpBall)!.x).toBeCloseTo(4, 10);
  });
});

describe("frame lerp carriers", () => {
  it("interpolates continuous fields, carries discrete ones from the nearer sample", () => {
    const orb = { x: 1, d: 3, h: 9, age: 2 };
    const a = f(0, 0, { facing: 1, orb: null });
    const c = f(1, 10, { facing: -1, orb });
    const early = lerpFrame(a, c, 0.25);
    expect(early.x).toBeCloseTo(2.5, 10);
    expect(early.facing).toBe(1);
    expect(early.orb).toBeNull();
    const late = lerpFrame(a, c, 0.75);
    expect(late.facing).toBe(-1);
    expect(late.orb).toBe(orb);
  });

  it("lerps the pose clock and aim within a kind", () => {
    const a = f(0, 0, { pose: { kind: "aim", t: 0, aimAngle: 0.4, aimPower: 0 } });
    const c = f(1, 10, { pose: { kind: "aim", t: 0, aimAngle: 0.8, aimPower: 1 } });
    const mid = lerpFrame(a, c, 0.5);
    expect(mid.pose.aimAngle).toBeCloseTo(0.6);
    expect(mid.pose.aimPower).toBeCloseTo(0.5);
  });

  it("carries bubble text the same way", () => {
    const a = f(0, 0, { bubble: { text: "hi", age: 0.1 } });
    const c = f(1, 10, { bubble: null });
    expect(lerpFrame(a, c, 0.2)!.bubble?.text).toBe("hi");
    expect(lerpFrame(a, c, 0.8)!.bubble).toBeNull();
  });
});
