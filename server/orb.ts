import { rollOrbSpawn, type OrbState } from "../src/shared/orb";
import type { OrbTiming } from "../src/shared/tierRules";

// ── Server-authoritative world objects ────────────────────────────────
// Some things exist in the WORLD, not on any client: the server decides
// when they appear, disappear, and who they affect; clients only render
// what they're told. The shared score/tier (WorldState) is one such
// object; the teleport orb is another. The pattern for each:
//   - state shape + pure rules in src/shared/   (orb.ts)
//   - lifecycle + decisions in a server module   (this file)
//   - Room broadcasts the events; welcome/snapshot carry current state
//     so late joiners and dropped packets self-heal.
//
// OrbAuthority owns the orb's clock: spawn after a cadence, expire after
// a lifetime, respawn a cadence after it's gone (consumed or expired).
// The timing comes from the TIER (shared/tierRules.orbTimingForTier):
// tiers 1–2 keep the fixed prototype rhythm; Hoop 3's Ambient/Spawn
// Change switches to a random 10–20 s cadence with a 5 s life. The
// getter is re-read every cycle, so an upgrade re-times the clock live.

export class OrbAuthority {
  private orb: OrbState | null = null;
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly events: {
      onSpawn: (orb: OrbState) => void;
      onExpire: (seq: number) => void;
    },
    private readonly timing: () => OrbTiming,
  ) {
    this.scheduleSpawn();
  }

  /** The live orb right now (for snapshots + throw resolution). */
  get current(): OrbState | null {
    return this.orb;
  }

  /**
   * A ball ruled to hit orb `seq` just reached it. Returns the orb if it
   * is still that orb (consume it), null if it expired / was already
   * taken — the caller falls back to a normal throw resolution.
   */
  consume(seq: number): OrbState | null {
    if (!this.orb || this.orb.seq !== seq) return null;
    const taken = this.orb;
    this.orb = null;
    this.clearTimer();
    this.scheduleSpawn();
    return taken;
  }

  /** Room is being torn down — stop the clock. */
  stop() {
    this.stopped = true;
    this.clearTimer();
  }

  private scheduleSpawn() {
    if (this.stopped) return;
    const t = this.timing();
    const cadenceS =
      t.minCadenceS + Math.random() * (t.maxCadenceS - t.minCadenceS);
    this.timer = setTimeout(() => {
      this.orb = rollOrbSpawn(++this.seq);
      this.events.onSpawn(this.orb);
      this.scheduleExpiry();
    }, cadenceS * 1000);
  }

  private scheduleExpiry() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      const o = this.orb;
      if (!o) return;
      this.orb = null;
      this.events.onExpire(o.seq);
      this.scheduleSpawn();
    }, this.timing().lifeS * 1000);
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
