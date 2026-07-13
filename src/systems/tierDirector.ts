import { hoopGeometryForTier, type HoopGeometry } from "../shared/tierRules";

// The client-side player of tier recipes (shared/tiers.ts). It owns the
// APPLIED tier — the tier the world is currently drawn/simulated at —
// and the two ways a world reaches a tier:
//
//   applyInstant  — no animation: late joiners load straight into the
//                   upgraded world; snapshots self-heal a missed event.
//   playUpgrade   — the live moment: the VFX burst + the tier's ordered
//                   change-list choreography (built out in step 4).
//
// The scene supplies hooks that actually touch Phaser objects; the
// director decides WHAT plays and WHEN.

export interface TierDirectorHooks {
  /** destroy the current hoop and build the given geometry */
  rebuildHoop(geom: HoopGeometry): void;
}

export class TierDirector {
  private applied = 1;

  constructor(private readonly hooks: TierDirectorHooks) {}

  /** The tier the world is drawn/simulated at right now. */
  get tierId(): number {
    return this.applied;
  }

  /** Jump straight to a tier with NO animation (late join, self-heal). */
  applyInstant(tierId: number) {
    if (tierId === this.applied) return;
    this.applied = tierId;
    this.hooks.rebuildHoop(hoopGeometryForTier(tierId));
  }
}
