import { BALANCE as T } from "./config";

// The distance curve (owner spec 2026-07-17, docs/scoring-curve.md):
// every make banks basePts, plus a logistic distance bonus. Stepping
// out of the keep-out zone pays off fast; past the curve's midpoint the
// gains diminish; the deep court is flat. The 3-point line is court art
// now - it plays no scoring role.
//
//   add(d) = maxAdd * (sig(k(d - mid)) - sig(k(edge - mid)))
//                     / (1 - sig(k(edge - mid)))
//
// normalized so the add is EXACTLY 0 at the keep-out edge (the closest
// legal shot) and exactly maxAdd at saturation.

function sig(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Points for a MADE basket from `distM` floor meters, through ONE rim. */
export function pointsForDistance(distM: number, tierId = 1): number {
  const s = T.score;
  const c = tierId >= 2 ? s.curves.tier2plus : s.curves.tier1;
  const edge = T.move.hoopStandoffM;
  const floor = sig(c.k * (edge - c.midM));
  const t = (sig(c.k * (distM - c.midM)) - floor) / (1 - floor);
  return Math.round(s.basePts + c.maxAddPts * Math.max(0, t));
}

/** The double hoop's smaller upper rim pays upperRimMult; any other rim
 *  pays the plain curve value. */
export function rimPoints(distM: number, tierId: number, rimId: string): number {
  const per = pointsForDistance(distM, tierId);
  return rimId === "upper" ? Math.round(per * T.score.upperRimMult) : per;
}

/**
 * A slam (the purple-orb throw) pays flat slamPts per rim made - so a
 * teleport DOUBLE through both tier-3 rims pays 200, not 100 (owner
 * ask 2026-07-19: "100 pts for a teleport double is not right").
 * Distance stays deliberately ignored; clamped so a stray rims count
 * can never mint more than the double.
 */
export function slamPoints(rimsMade: number): number {
  return T.score.slamPts * Math.min(2, Math.max(1, rimsMade));
}

/**
 * Points for a made throw given the rims it went through, in order. A
 * tier-3 "double shot" sums both rims (lower + upper = 2.25x the curve).
 * An empty list still pays one plain rim - a scored ball always banks.
 */
export function pointsForRims(
  distM: number,
  tierId: number,
  rimsMade: readonly string[],
): number {
  if (rimsMade.length === 0) return pointsForDistance(distM, tierId);
  let sum = 0;
  for (const id of rimsMade) sum += rimPoints(distM, tierId, id);
  return sum;
}
