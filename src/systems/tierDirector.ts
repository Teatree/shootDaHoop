import Phaser from "phaser";
import { T } from "../tuning";
import {
  ballLookForTier,
  courtLookForTier,
  getTier,
  hoopChoreoGeometries,
  hoopGeometryForTier,
  hoopLookForTier,
  interactivesForTier,
  type HoopGeometry,
} from "../shared/tierRules";
import type {
  BallLookId,
  CourtLookId,
  FxKind,
  HoopLook,
  InteractiveElement,
} from "../shared/tierChanges";

// The client-side player of tier recipes (shared/tiers.ts). It owns the
// APPLIED tier — the tier the world is currently drawn/simulated at —
// and the two ways a world reaches a tier:
//
//   applyInstant  — no animation: late joiners load straight into the
//                   upgraded world; snapshots self-heal a missed event;
//                   world resets snap back to tier 1.
//   playUpgrade   — the live moment: the tier's ORDERED change list
//                   plays out as choreography, each change through its
//                   change-type hook, hoop beats through the staged
//                   geometries of shared/tierRules.hoopChoreoGeometries.
//
// GAMEPLAY FLIPS ATOMICALLY: `tierId` (which physics/power/camera read)
// moves the moment playUpgrade starts; only the VISUALS lag through the
// beats. Players are teleported clear when an upgrade fires, so nothing
// meaningful can be thrown at a half-built hoop.
//
// The scene supplies hooks that actually touch Phaser objects; the
// director decides WHAT plays and WHEN. A snapshot arriving mid-
// choreography carries the tier we already applied → applyInstant
// no-ops and the playback is undisturbed.

export interface TierDirectorHooks {
  /** destroy the current hoop and build the given geometry + paint job */
  rebuildHoop(geom: HoopGeometry, look: HoopLook): void;
  /** pop/splash presentation at the hoop (one choreography beat landed) */
  hoopFx(fx: FxKind): void;
  /** reskin the court floor; fx null = instant (no transition) */
  redrawCourt(look: CourtLookId, fx: FxKind | null): void;
  /** swap the ball look everywhere; fx null = instant */
  setBallLook(look: BallLookId, fx: FxKind | null): void;
  /** place an interactive element; animated = play its appearFx */
  spawnInteractive(el: InteractiveElement, animated: boolean): void;
  /** remove every placed interactive (a world reset back down a tier) */
  clearInteractives(): void;
}

export class TierDirector {
  private applied = 1;
  private timers: Phaser.Time.TimerEvent[] = [];
  /** an upgrade that fired while the player was AFK — replayed on return */
  private deferred: number | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hooks: TierDirectorHooks,
  ) {}

  /** The tier the world is simulated at right now (visuals may lag beats). */
  get tierId(): number {
    return this.applied;
  }

  /** The ball look of the applied tier — recordings stamp this. */
  get ballLook(): BallLookId {
    return ballLookForTier(this.applied);
  }

  /** Jump straight to a tier with NO animation (late join, self-heal). */
  applyInstant(tierId: number) {
    if (this.deferred !== null) {
      // an AFK catch-up replay is queued: snapshots carrying that same
      // tier must NOT preempt the show; any OTHER tier means the world
      // moved elsewhere (another upgrade, a reset) — drop the hold
      if (tierId === this.deferred) return;
      this.deferred = null;
    }
    if (tierId === this.applied) return;
    this.cancelPlayback();
    this.applied = tierId;
    this.applyFinalState();
  }

  // ── AFK catch-up (HOOP_PROGRESSION.md): an upgrade that fires while
  // the player is away holds the OLD world on their screen; their first
  // input plays the full transformation, so nobody misses the payoff ──

  /** Queue the upgrade's choreography instead of playing it now. */
  deferUpgrade(tierId: number) {
    this.deferred = tierId;
  }

  get hasDeferred(): boolean {
    return this.deferred !== null;
  }

  /** The player is back — play the held transformation. */
  playDeferred() {
    const t = this.deferred;
    this.deferred = null;
    if (t === null) return;
    // PLACEHOLDER (presentation): the catch-up is the FULL choreography.
    // If the world upgraded more than once while away, the intermediate
    // recipes can't chain — snap through them and play only the last leg.
    if (t === this.applied + 1) this.playUpgrade(t);
    else this.applyInstant(t);
  }

  /** The live upgrade moment: play the tier's ordered change list. */
  playUpgrade(tierId: number) {
    if (tierId === this.applied) return;
    this.deferred = null;
    this.cancelPlayback();
    const tier = getTier(tierId);
    if (!tier || tierId !== this.applied + 1) {
      // a recipe choreographs ONE rung of the ladder — a jump (missed
      // events while disconnected/AFK across several upgrades) snaps
      this.applied = tierId;
      this.applyFinalState();
      return;
    }
    this.applied = tierId; // gameplay flips atomically; visuals follow

    const fx = T.progressionFx;
    const geoms = hoopChoreoGeometries(tierId);
    let at = fx.leadMs;
    for (const change of tier.changes) {
      switch (change.type) {
        case "hoop-change":
          change.choreo.forEach((beat, i) => {
            if (beat.beat === "wait") {
              at += beat.delayS * 1000; // the doc's explicit pauses
              return;
            }
            const geom = geoms[i];
            this.at(at, () => {
              this.hooks.rebuildHoop(geom, hoopLookForTier(this.applied));
              if (beat.fx !== "none") this.hooks.hoopFx(beat.fx);
            });
            at += fx.hoopBeatMs;
          });
          break;
        case "interactive":
          this.at(at, () => this.hooks.spawnInteractive(change, true));
          at += fx.changeBeatMs;
          break;
        case "permanent-effect":
          this.at(at, () => this.hooks.setBallLook(change.ballLook, change.uiFx));
          at += fx.changeBeatMs;
          break;
        case "scene-visual":
          this.at(at, () => this.hooks.redrawCourt(change.look, change.fx));
          at += fx.changeBeatMs;
          break;
        case "new-animation":
          break; // a data unlock — nothing to stage
        case "ambient-spawn":
          break; // the authority's spawn clock changes — nothing to stage
      }
    }
  }

  /** Everything the applied tier implies, applied at once, no animation. */
  private applyFinalState() {
    this.hooks.rebuildHoop(
      hoopGeometryForTier(this.applied),
      hoopLookForTier(this.applied),
    );
    this.hooks.redrawCourt(courtLookForTier(this.applied), null);
    this.hooks.setBallLook(ballLookForTier(this.applied), null);
    this.hooks.clearInteractives(); // resets tear DOWN; upgrades re-add
    for (const el of interactivesForTier(this.applied))
      this.hooks.spawnInteractive(el, false);
  }

  private at(ms: number, fn: () => void) {
    const timer = this.scene.time.delayedCall(ms, () => {
      this.timers = this.timers.filter((t) => t !== timer);
      fn();
    });
    this.timers.push(timer);
  }

  /** A newer state takes over — drop any beats still scheduled. */
  private cancelPlayback() {
    for (const t of this.timers) t.remove(false);
    this.timers = [];
  }
}
