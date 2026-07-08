import Phaser from "phaser";
import { T } from "./tuning";
import { M, RIM, sortDepth, toScreen } from "./world";

// The teleport orb: a pulsing blue circle that hangs in the air near the
// hoop. Hit it with a thrown ball and the player teleports up to it
// (CourtScene runs the levitate → fall → face-down state machine).
// One orb at a time; each lives T.tp.lifeS seconds, and the next appears
// T.tp.cadenceS after the previous one is gone.

interface Orb {
  x: number; //  meters
  d: number;
  h: number;
  age: number;
  fading: boolean;
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  shine: Phaser.GameObjects.Arc;
}

export class TeleportOrb {
  private orb: Orb | null = null;
  private cooldown = T.tp.cadenceS;

  constructor(private readonly scene: Phaser.Scene) {}

  update(dt: number) {
    if (!this.orb) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.spawn();
      return;
    }

    const o = this.orb;
    o.age += dt;

    // idle: pulse the core, breathe the light behind it
    const pulse = 1 + 0.12 * Math.sin(o.age * Math.PI * 2 * T.tp.pulseHz);
    o.core.setScale(pulse);
    o.glow.setScale(pulse * (1.15 + 0.1 * Math.sin(o.age * 5)));
    o.glow.setAlpha(0.3 + 0.12 * Math.sin(o.age * Math.PI * 2 * T.tp.pulseHz));

    if (!o.fading && o.age >= T.tp.lifeS) this.expire();
  }

  /**
   * Ball overlap test. Consumes the orb and returns its position when hit;
   * null otherwise.
   */
  tryHit(bx: number, bd: number, bh: number): { x: number; d: number; h: number } | null {
    const o = this.orb;
    if (!o || o.fading) return null;
    const hitR = T.tp.radiusM + T.throw.ballRadiusM;
    if (Math.abs(bd - o.d) > 0.6) return null;
    if (Math.hypot(bx - o.x, bh - o.h) > hitR) return null;
    const pos = { x: o.x, d: o.d, h: o.h };
    this.destroyOrb(); // consumed — no fade, the zap replaces it
    return pos;
  }

  private spawn() {
    const zoneEdgeM = RIM.x - T.move.hoopStandoffM;
    const x = zoneEdgeM - (Math.random() * T.tp.rangeXPx) / M;
    const h =
      T.hoop.rimHeightM +
      (T.tp.aboveHoopPx + Math.random() * T.tp.rangeHPx) / M;
    const d = RIM.d;

    const { sx, sy } = toScreen(x, d, h);
    const r = T.tp.radiusM * M;
    const depth = sortDepth(d);
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

    this.orb = { x, d, h, age: 0, fading: false, glow, core, shine };
  }

  private expire() {
    const o = this.orb;
    if (!o) return;
    o.fading = true;
    this.scene.tweens.add({
      targets: [o.glow, o.core, o.shine],
      alpha: 0,
      duration: T.tp.fadeMs,
      ease: "Cubic.easeIn",
      onComplete: () => this.destroyOrb(),
    });
  }

  private destroyOrb() {
    const o = this.orb;
    if (!o) return;
    o.glow.destroy();
    o.core.destroy();
    o.shine.destroy();
    this.orb = null;
    this.cooldown = T.tp.cadenceS;
  }
}
