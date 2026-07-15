import { BALANCE } from "./config";
import { createBallState, PHYSICS_DT, stepBall } from "./physics";
import { pointsForDistance } from "./scoring";
import { floorDistToRim } from "./court";
import { orbHitTest, type OrbState } from "./orb";
import { hoopGeometryForTier } from "./tierRules";
import type { ThrowLaunch } from "./messages";

// The server-side throw resolver: runs the SAME stepBall at the SAME
// fixed PHYSICS_DT the client's visual ball steps with (ball.ts), so a
// launch resolves to exactly one authoritative outcome AND the flight
// every screen animates is that same trajectory. Dependency-free.
//
// Outcomes stay organic because launch params come from analog human
// input; determinism only guarantees that ONE given launch has ONE
// result, everywhere.

export interface ThrowResolution {
  made: boolean;
  swish: boolean;
  /** rims made this throw - 2 on a tier-3 "double shot" */
  rims: number;
  /** floor distance the shot was taken from - drives the points table */
  distM: number;
  points: number; // 0 when missed
  /** seconds from launch until the outcome was decided */
  resolvedAtS: number;
  /**
   * Set when the arc passed through the given orb BEFORE resolving: the
   * ball is consumed at this time - no score, the thrower teleports.
   * (The authority must still confirm the orb is alive at that moment.)
   */
  orbHitAtS?: number;
}

const FIXED_DT = PHYSICS_DT;

export function resolveThrow(
  launch: ThrowLaunch,
  orb?: OrbState | null,
  tierId = 1,
): ThrowResolution {
  const s = createBallState(launch.x, launch.d, launch.h, launch.vx, launch.vh);
  const distM = floorDistToRim(launch.shotX, launch.shotD);
  const geom = hoopGeometryForTier(tierId);

  let t = 0;
  while (!s.resolved && t < BALANCE.ground.maxLifeS) {
    stepBall(s, FIXED_DT, geom);
    t += FIXED_DT;
    if (orb && orbHitTest(orb, s.x, s.d, s.h)) {
      // consumed by the orb - the throw ends here, unscored
      return {
        made: false,
        swish: false,
        rims: 0,
        distM,
        points: 0,
        resolvedAtS: t,
        orbHitAtS: t,
      };
    }
  }

  const made = s.scored;
  const rims = s.rimsMade.length;
  return {
    made,
    swish: made && !s.rimTouched,
    rims,
    distM,
    // PLACEHOLDER (tune): a double shot scores each rim's full points -
    // pointsForDistance × rims. The doc names the mechanic, not the math.
    points: made
      ? launch.slam
        ? BALANCE.score.slamPts
        : pointsForDistance(distM) * Math.max(1, rims)
      : 0,
    resolvedAtS: t,
  };
}
