import Phaser from "phaser";
import { T } from "./tuning";
import { RIM, screenToFloor, toScreen } from "./world";
import type { Player } from "./player";
import type { PowerCurve } from "./shared/tierRules";

export interface Shot {
  vx: number; // m/s toward the hoop (+x)
  vh: number; // m/s up
  power: number; // 0..1 fraction of max — drives the preview's meter look
}

// power-meter heat: cream (soft) → amber (medium) → red (full)
const HEAT_STOPS = [0xfff3d6, 0xffb84d, 0xff5030];

function heatColor(t: number): number {
  const seg = t < 0.5 ? 0 : 1;
  const f = (t - seg * 0.5) * 2;
  const a = Phaser.Display.Color.ValueToColor(HEAT_STOPS[seg]);
  const b = Phaser.Display.Color.ValueToColor(HEAT_STOPS[seg + 1]);
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, 100, f * 100);
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

// Right-click + hold → aim AT the cursor (direction = release point →
// pointer), then DRAG OUT to charge: power grows with drag distance from
// the press point, not with where the cursor sits. Release → throw.
// Left-click → walk.
export class AimController {
  private aiming = false;
  private startX = 0;
  private startY = 0;
  private curX = 0;
  private curY = 0;

  private readonly preview: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
    private readonly onThrow: (shot: Shot) => void,
    private readonly onWalkClick: (sx: number, sy: number) => void,
    /** the ACTIVE tier's power curve — the ball-range permanent effect
     *  raises it, so a getter, not a constant */
    private readonly power: () => PowerCurve,
  ) {
    this.preview = scene.add.graphics().setDepth(900);

    scene.input.on(
      "pointerdown",
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (p.rightButtonDown()) {
          this.begin(p);
        } else if (p.leftButtonDown() && !this.aiming && over.length === 0) {
          // clicks on interactive world objects (upgrade button, jukebox…)
          // are theirs — a bare floor click is a walk
          const wp = scene.cameras.main.getWorldPoint(p.x, p.y);
          const { x, d } = screenToFloor(wp.x, wp.y);
          this.player.walkTo(x, d);
          this.onWalkClick(wp.x, wp.y);
        }
      },
    );

    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.aiming) {
        this.curX = p.x;
        this.curY = p.y;
      }
    });

    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this.aiming && p.button === 2) this.release();
    });
  }

  private begin(p: Phaser.Input.Pointer) {
    if (this.player.control === "none") return;
    this.aiming = true;
    this.startX = this.curX = p.x;
    this.startY = this.curY = p.y;
    this.player.enterStance(); // stops any walk instantly
  }

  private release() {
    this.aiming = false;
    this.preview.clear();
    this.player.exitStance();
    const shot = this.computeShot();
    if (shot) this.onThrow(shot);
  }

  get isAiming(): boolean {
    return this.aiming;
  }

  /** Abort the current aim without throwing (e.g. levitation ran out). */
  cancel() {
    if (!this.aiming) return;
    this.aiming = false;
    this.preview.clear();
    this.player.exitStance();
  }

  /**
   * Launch velocity, or null in the deadzone. Direction: from the release
   * point toward the cursor. Power: how far the cursor was DRAGGED from
   * where the right-click started (screen px, zoom-independent).
   */
  private computeShot(): Shot | null {
    const a = T.aim;
    const dragLen = Math.hypot(this.curX - this.startX, this.curY - this.startY);
    if (dragLen < a.deadzonePx) return null;

    const cam = this.scene.cameras.main;
    const wp = cam.getWorldPoint(this.curX, this.curY); // cursor → world px
    const rp = this.player.releasePoint(); //              (x, d, h) meters
    const rs = toScreen(rp.x, rp.d, rp.h); //              release → world px
    const dx = wp.x - rs.sx;
    const dy = wp.y - rs.sy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null; // cursor on top of the release point: no direction

    const t = Phaser.Math.Clamp(dragLen / a.maxDragPx, 0, 1);
    // eased power curve: fine control at the low end; the curve's range
    // is the ACTIVE tier's (ball-range effect = longer throws)
    const pw = this.power();
    const power =
      pw.minPowerM + (pw.maxPowerM - pw.minPowerM) * Math.pow(t, a.powerExponent);

    return {
      vx: (dx / len) * power,
      vh: (-dy / len) * power, // screen y is down
      power: t,
    };
  }

  update() {
    if (!this.aiming) return;
    this.preview.clear();
    const shot = this.computeShot();
    // feed the live aim into the character pose (the hold leans with it
    // and pulls back with power) — deadzone = ball held, no lean yet
    this.player.aimInfo = shot
      ? { angle: Math.atan2(shot.vh, shot.vx), power: shot.power }
      : null;
    if (!shot) return;

    // Simulate the true flight; the drawn arc is the POWER METER:
    // its length grows with power and its dots heat cream → red.
    // Dots shrink and fade along the arc so the line dissipates
    // instead of hard-stopping — except at 100% power, where it ends
    // in a pulsing ring: you're at the limit.
    const a = T.aim;
    const atMax = shot.power >= 1;
    const maxLen = Phaser.Math.Linear(
      a.previewMinLenM,
      a.previewMaxLenM,
      shot.power,
    );
    const color = heatColor(shot.power);
    const rp = this.player.releasePoint();
    let px: number = rp.x;
    let ph: number = rp.h;
    let pd: number = rp.d; // depth eases toward the rim lane, like the ball
    let vx = shot.vx;
    let vh = shot.vh;
    const step = 1 / 90;
    let travelled = 0;
    let sinceDot = 0;
    let endSX = 0;
    let endSY = 0;

    for (let i = 0; i < 400 && travelled < maxLen && ph > 0; i++) {
      vh -= T.throw.gravityM * step;
      const nx = px + vx * step;
      const nh = ph + vh * step;
      const seg = Math.hypot(nx - px, nh - ph);
      travelled += seg;
      sinceDot += seg;
      px = nx;
      ph = nh;
      // mirror Ball.update's depth easing so the drawn line IS the true
      // screen path — the ball's center tracks these dots exactly
      pd += (RIM.d - pd) * Math.min(1, T.throw.depthEaseRate * step);
      const { sx, sy } = toScreen(px, pd, ph);
      endSX = sx;
      endSY = sy;
      if (sinceDot >= a.previewDotSpacingM) {
        sinceDot = 0;
        const f = Math.min(1, travelled / maxLen); // 0..1 along the preview
        const size = Phaser.Math.Linear(a.previewDotStartPx, a.previewDotEndPx, f);
        // f² eases the fade so it dissipates late, not linearly
        const alpha = Phaser.Math.Linear(a.previewAlphaStart, a.previewAlphaEnd, f * f);
        this.preview.fillStyle(color, alpha);
        this.preview.fillCircle(sx, sy, size);
      }
    }

    if (atMax) {
      // pulsing cap ring — the visible power limit
      const pulse = 0.7 + 0.3 * Math.sin(this.scene.time.now / 90);
      this.preview.lineStyle(2.5, 0xff5030, 0.9 * pulse);
      this.preview.strokeCircle(endSX, endSY, a.previewCapRingPx * pulse);
    }
  }
}
