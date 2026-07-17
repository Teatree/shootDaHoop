import { describe, expect, it } from "vitest";
import { MAX_SHOWN, rollLine } from "./shareRoll";

// Share v5 (owner redesign 2026-07-17): hits only - a 🏀 per make,
// capped at MAX_SHOWN then "...", misses invisible, points in bold.

describe("rollLine", () => {
  it("renders one ball per hit with the points", () => {
    expect(rollLine(3, 345)).toBe("🏀🏀🏀 **+345pts**");
  });

  it("caps the balls at MAX_SHOWN and appends ... beyond it", () => {
    expect(rollLine(MAX_SHOWN, 500)).toBe("🏀".repeat(MAX_SHOWN) + " **+500pts**");
    expect(rollLine(7, 900)).toBe("🏀".repeat(MAX_SHOWN) + "... **+900pts**");
  });

  it("zero hits still reads (the button never shows for it anyway)", () => {
    expect(rollLine(0, 0)).toBe(" **+0pts**");
  });
});
