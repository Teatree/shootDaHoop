import { BALANCE as T } from "./config";

/**
 * Points for a MADE basket shot from `distM` court-meters (floor distance).
 *   inside the 3pt line → insidePts
 *   at / beyond the line → threePts + perMeterPts per meter past it, capped
 */
export function pointsForDistance(distM: number): number {
  const s = T.score;
  if (distM < T.court.threePtM) return s.insidePts;
  const beyond = distM - T.court.threePtM;
  return Math.min(s.capPts, Math.round(s.threePts + s.perMeterPts * beyond));
}
