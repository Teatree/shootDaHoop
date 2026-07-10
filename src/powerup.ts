import Phaser from "phaser";
import { T } from "./tuning";
import { M, sortDepth, toScreen } from "./world";
import { orbHitTest, type OrbState } from "./shared/orb";

// The teleport orb, RENDER side only: a pulsing blue circle that hangs in
// the air near the hoop. The orb is a server-authoritative world object —
// the authority (server Room, or LocalBackend offline) decides when one
// spawns, expires, or is consumed; this class just draws the state it is
// told and answers overlap queries for the local player's own balls
// (optimistic feel — the authority's ruling still wins).

interface OrbView {
  state: OrbState;
  age: number;
  fading: boolean;
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  shine: Phaser.GameObjects.Arc;
}

export class TeleportOrb {
  private orb: OrbView | null = null;
  /** highest seq already removed here — dedupes echo/snapshot races */
  private removedSeq = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** The orb currently rendered (null between orbs). */
  get current(): OrbState | null {
    return this.orb && !this.orb.fading ? this.orb.state : null;
  }

  update(dt: number) {
    const o = this.orb;
    if (!o) return;
    o.age += dt;

    // idle: pulse the core, breathe the light behind it
    const pulse = 1 + 0.12 * Math.sin(o.age * Math.PI * 2 * T.tp.pulseHz);
    o.core.setScale(pulse);
    o.glow.setScale(pulse * (1.15 + 0.1 * Math.sin(o.age * 5)));
    o.glow.setAlpha(0.3 + 0.12 * Math.sin(o.age * Math.PI * 2 * T.tp.pulseHz));
  }

  /** What's on screen right now — sampled by ghost recordings. */
  sample(): { x: number; d: number; h: number; age: number } | null {
    const o = this.orb;
    return o && !o.fading
      ? { x: o.state.x, d: o.state.d, h: o.state.h, age: o.age }
      : null;
  }

  /** Ball overlap test (does NOT remove — the caller reports the hit). */
  hitTest(bx: number, bd: number, bh: number): OrbState | null {
    const o = this.current;
    return o && orbHitTest(o, bx, bd, bh) ? o : null;
  }

  /** The authority spawned an orb (or a snapshot is self-healing one in). */
  show(orb: OrbState) {
    if (orb.seq <= this.removedSeq) return; // already removed locally
    if (this.orb?.state.seq === orb.seq) return; // already showing it
    this.destroyOrb();

    const { sx, sy } = toScreen(orb.x, orb.d, orb.h);
    const r = T.orb.radiusM * M;
    const depth = sortDepth(orb.d);
    const glow = this.scene.add
      .circle(sx, sy, r * 2.1, 0x9fd0ff, 0.3)
      .setDepth(depth - 1);
    const core = this.scene.add
      .circle(sx, sy, r, 0x2e7bff, 0.95)
      .setDepth(depth);
    const shine = this.scene.add
      .circle(sx - r * 0.3, sy - r * 0.3, r * 0.3, 0xd8ecff, 0.85)
      .setDepth(depth + 1);

    // pop in
    for (const c of [glow, core, shine]) c.setScale(0);
    this.scene.tweens.add({
      targets: [glow, core, shine],
      scale: 1,
      duration: T.tp.popMs,
      ease: "Back.easeOut",
    });

    this.orb = { state: orb, age: 0, fading: false, glow, core, shine };
  }

  /**
   * The orb is gone: consumed (instant — a zap replaces it) or expired
   * (fade out). Idempotent per seq, so the authority's confirmation of a
   * locally-predicted hit is a no-op.
   */
  removeBySeq(seq: number, consumed: boolean) {
    if (seq > this.removedSeq) this.removedSeq = seq;
    const o = this.orb;
    if (!o || o.state.seq !== seq || o.fading) return;
    if (consumed) {
      this.destroyOrb();
      return;
    }
    o.fading = true;
    this.scene.tweens.add({
      targets: [o.glow, o.core, o.shine],
      alpha: 0,
      duration: T.tp.fadeMs,
      ease: "Cubic.easeIn",
      onComplete: () => {
        if (this.orb === o) this.destroyOrb();
      },
    });
  }

  private destroyOrb() {
    const o = this.orb;
    if (!o) return;
    o.glow.destroy();
    o.core.destroy();
    o.shine.destroy();
    this.orb = null;
  }
}
