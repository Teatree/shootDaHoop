import { BALANCE } from "./config";
import { createBallState, stepBall } from "./physics";
import { pointsForDistance } from "./scoring";
import { floorDistToRim } from "./court";
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
}

const FIXED_DT = 1 / 120;

export function resolveThrow(launch: ThrowLaunch): ThrowResolution {
  const s = createBallState(launch.x, launch.d, launch.h, launch.vx, launch.vh);
  const distM = floorDistToRim(launch.shotX, launch.shotD);

  let t = 0;
  while (!s.resolved && t < BALANCE.ground.maxLifeS) {
    stepBall(s, FIXED_DT);
    t += FIXED_DT;
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
