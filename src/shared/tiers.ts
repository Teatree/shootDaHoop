// Hoop tiers — DATA-DRIVEN shared progression: cumulative community score
// unlocks a ladder of hoops, each a different challenge that transforms the
// world. A tier is a data entry; adding Hoops 2–6 later is a content change,
// not a code change. Dependency-free.

/**
 * Hoop behaviours are pluggable: the throw/scoring code must not care which
 * is active. The client maps each id to a behaviour implementation; today
 * only "static" exists (the current hoop).
 */
export type HoopBehaviourId = "static"; // later: "double" | "moving" | "walking" | …

export interface HoopTierDef {
  id: number;
  /** cumulative shared score needed to unlock this tier */
  threshold: number;
  hoopBehaviour: HoopBehaviourId;
  /** world-dressing chapter shown once this tier is reached */
  visualChapter: string;
  /** amenity object unlocked with the tier (presence-only for now) */
  amenity: string | null;
}

export const HOOP_TIERS: readonly HoopTierDef[] = [
  {
    id: 1,
    threshold: 0,
    hoopBehaviour: "static",
    visualChapter: "desert-dawn",
    amenity: null,
  },
  // Hoops 2–6 land here as data entries (threshold, behaviour, chapter,
  // amenity) once the tier designs exist.
] as const;

/** The highest tier whose threshold the shared score has reached. */
export function tierForScore(sharedScore: number): HoopTierDef {
  let best = HOOP_TIERS[0];
  for (const t of HOOP_TIERS) {
    if (sharedScore >= t.threshold && t.threshold >= best.threshold) best = t;
  }
  return best;
}
