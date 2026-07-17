import { describe, expect, it } from "vitest";
import { rollLine } from "./shareRoll";
import { BALANCE } from "./config";

// The share blurb's middle line: the emoji roll, the banked points and
// the two (max) fire conditions - all pinned so a config tweak that
// silently changes the flair rules trips a test.

const hit = (points: number) => ({ made: true, points });
const miss = () => ({ made: false, points: 0 });

describe("rollLine", () => {
  it("renders spaced checks and red squares, with the sum", () => {
    expect(rollLine([hit(100), miss(), hit(100)])).toBe(
      "🏀: ✅ 🟥 ✅ **+200pts**",
    );
  });

  it("awards the perfect-day fire only at the full daily count", () => {
    const four = Array.from({ length: 4 }, () => hit(100));
    expect(rollLine(four)).not.toContain("🔥");
    const five = Array.from({ length: 5 }, () => hit(100));
    expect(rollLine(five)).toContain("🔥");
    // one miss in the run kills it
    expect(rollLine([...four, miss()])).not.toContain("🔥");
  });

  it("awards the hot-hand fire at 1.5x the closest-place score", () => {
    const inside = BALANCE.score.insidePts;
    // 2 hits from distance: 300 >= 1.5 * 2 * 100
    expect(rollLine([hit(inside * 1.5), hit(inside * 1.5)])).toContain("🔥");
    // same points on ONE hit - not a hot hand
    expect(rollLine([hit(inside * 3)])).not.toContain("🔥");
    // 2 close-range hits fall short
    expect(rollLine([hit(inside), hit(inside)])).not.toContain("🔥");
  });

  it("stacks both fires on a perfect long-range day", () => {
    const five = Array.from({ length: 5 }, () => hit(250));
    expect(rollLine(five)).toContain("🔥🔥");
  });

  it("caught balls simply never arrive - an empty roll still reads", () => {
    expect(rollLine([])).toBe("🏀:  **+0pts**");
  });
});
