import { BALANCE } from "./config";
import { createBallState, stepBall } from "./physics";
import { pointsForDistance } from "./scoring";
import { floorDistToRim } from "./court";
import { orbHitTest, type OrbState } from "./orb";
import type { ThrowLaunch } from "./messages";

// The server-side throw resolver: runs the SAME stepBall the client's live
// ball uses, but with a fixed internal dt, so a launch resolves to exactly
// one authoritative outcome. Clients animate their own ball for feel; the
// server's resolution decides the score. Dependency-free.
//
// Fixed dt here does NOT contradict the "live physics stays
// non-deterministic" design decision: launch params come from analog human
// input, so outcomes stay organic — this only guarantees that ONE given
// launch has ONE authoritative result.

export interface ThrowResolution {
  made: boolean;
  swish: boolean;
  /** floor distance the shot was taken from — drives the points table */
  distM: number;
  points: number; // 0 when missed
  /** seconds from launch until the outcome was decided */
  resolvedAtS: number;
  /**
   * Set when the arc passed through the given orb BEFORE resolving: the
   * ball is consumed at this time — no score, the thrower teleports.
   * (The authority must still confirm the orb is alive at that moment.)
   */
  orbHitAtS?: number;
}

const FIXED_DT = 1 / 120;

export function resolveThrow(
  launch: ThrowLaunch,
  orb?: OrbState | null,
): ThrowResolution {
  const s = createBallState(launch.x, launch.d, launch.h, launch.vx, launch.vh);
  const distM = floorDistToRim(launch.shotX, launch.shotD);

  let t = 0;
  while (!s.resolved && t < BALANCE.ground.maxLifeS) {
    stepBall(s, FIXED_DT);
    t += FIXED_DT;
    if (orb && orbHitTest(orb, s.x, s.d, s.h)) {
      // consumed by the orb — the throw ends here, unscored
      return {
        made: false,
        swish: false,
        distM,
        points: 0,
        resolvedAtS: t,
        orbHitAtS: t,
      };
    }
  }

  const made = s.scored;
  return {
    made,
    swish: made && !s.rimTouched,
    distM,
    points: made
      ? launch.slam
        ? BALANCE.score.slamPts
        : pointsForDistance(distM)
      : 0,
    resolvedAtS: t,
  };
}
