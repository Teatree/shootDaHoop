import { describe, expect, it } from "vitest";
import { T } from "./tuning";
import { pointsForDistance } from "./scoring";

describe("pointsForDistance", () => {
  it("scores insidePts anywhere inside the 3pt line", () => {
    expect(pointsForDistance(1)).toBe(T.score.insidePts);
    expect(pointsForDistance(T.court.threePtM - 0.01)).toBe(T.score.insidePts);
  });

  it("scores threePts exactly at the line", () => {
    expect(pointsForDistance(T.court.threePtM)).toBe(T.score.threePts);
  });

  it("adds perMeterPts per meter beyond the line", () => {
    expect(pointsForDistance(T.court.threePtM + 3)).toBe(
      T.score.threePts + 3 * T.score.perMeterPts,
    );
  });

  it("crosses the bigScore threshold where the rainbow log expects it", () => {
    // per-shot pts > bigScorePts triggers the rainbow line + big juice
    const atThreshold =
      T.court.threePtM +
      (T.score.bigScorePts - T.score.threePts) / T.score.perMeterPts;
    expect(pointsForDistance(atThreshold)).toBe(T.score.bigScorePts);
    expect(pointsForDistance(atThreshold + 0.1)).toBeGreaterThan(
      T.score.bigScorePts,
    );
  });

  it("caps at capPts no matter the distance", () => {
    expect(pointsForDistance(100)).toBe(T.score.capPts);
  });
});
