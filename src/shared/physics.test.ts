import { describe, expect, it } from "vitest";
import {
  createBallState,
  fastForwardBall,
  PHYSICS_DT,
  stepBall,
} from "./physics";

// The hidden-tab catch-up rests on one property: a fast-forwarded state
// IS the state every live screen reached by stepping the same quanta.

describe("fastForwardBall", () => {
  it("equals stepping a fresh state through the same PHYSICS_DT quanta", () => {
    const { s } = fastForwardBall(20, 3, 2.5, 8, 6, 1.0);
    const ref = createBallState(20, 3, 2.5, 8, 6);
    for (let t = 0; t < 1.0; t += PHYSICS_DT) stepBall(ref, PHYSICS_DT);
    expect(s).toEqual(ref);
  });

  it("reports rest for a span longer than the ball's whole life", () => {
    // a soft lob far from the hoop: bounces out and settles well inside 30 s
    const { rested } = fastForwardBall(5, 3, 2.5, 2, 3, 30);
    expect(rested).toBe(true);
  });

  it("a short hop is still in the air, not rested", () => {
    const { rested, s } = fastForwardBall(5, 3, 2.5, 8, 7, 0.5);
    expect(rested).toBe(false);
    expect(s.h).toBeGreaterThan(0);
  });
});
