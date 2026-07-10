import Phaser from "phaser";
import { T } from "./tuning";
import { clampToCourt, floorY, sortDepth, toScreen } from "./world";
import { ensurePlayerTexture } from "./placeholders";
import { burst, flash } from "./juice";
import { playSfx } from "./sfx";
import { shadowShift, type LightDir } from "./sky";
import type { PlayerInfo } from "./shared/messages";

// Another player's character: animated locally from their broadcast
// move-to intents (positions are never streamed). Mirrors Player's walk
// feel — same speed, same bob — with their own shirt colour and name tag.
// When the server rules their ball hit the teleport orb, `teleportTo`
// replays the zap + levitate → fall → face-down arc the local player has,
// so everyone watches the same slam attempt.

const ZAP = [0x2e7bff, 0x9fd0ff, 0xffffff] as const;

export class RemoteAvatar {
  x: number;
  d: number;
  /** feet height above the floor — non-zero through a teleport arc */
  airH = 0;

  readonly name: string;

  private walking = false;
  private targetX = 0;
  private targetD = 0;
  private bobT = 0;
  private light: LightDir = { dx: 0, elev: 1 };

  private tpState: "none" | "levitate" | "fall" | "down" = "none";
  private tpTimer = 0;
  private returnD = 0; // depth row to fall back onto
  private fallV = 0;

  private readonly sprite: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(
    private readonly scene: Phaser.Scene,
    info: PlayerInfo,
  ) {
    this.x = info.x;
    this.d = info.d;
    this.name = info.name;
    this.shadow = scene.add.ellipse(0, 0, 26, 8, 0x000000, 0.22);
    this.sprite = scene.add
      .image(0, 0, ensurePlayerTexture(scene, info.shirtColor))
      .setOrigin(0.5, 1);
    this.label = scene.add
      .text(0, 0, info.name, {
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: "11px",
        fontStyle: "bold",
        color: "#6ac48a",
      })
      .setOrigin(0.5, 1)
      .setAlpha(0.65)
      .setResolution(2);
    this.render();
  }

  /** A broadcast movement intent — walk there like the original did. */
  walkTo(x: number, d: number) {
    if (this.tpState !== "none") return; // mid-teleport: no walking
    const c = clampToCourt(x, d);
    this.targetX = c.x;
    this.targetD = c.d;
    this.walking = true;
    this.sprite.setFlipX(c.x < this.x);
  }

  /** Snapshot reconciliation — snap without walking. */
  setPos(x: number, d: number) {
    if (this.walking || this.tpState !== "none") return; // animating, intent will land us
    this.x = x;
    this.d = d;
  }

  /** The server ruled their ball hit the orb — zap them up to it. */
  teleportTo(x: number, d: number, h: number) {
    // zapp out…
    const fs = toScreen(this.x, this.d, this.airH + 1);
    flash(this.scene, fs.sx, fs.sy, 30);
    burst(this.scene, fs.sx, fs.sy, 24, ZAP, 260);

    this.walking = false;
    this.returnD = this.d;
    this.x = x;
    this.d = d;
    this.airH = h;
    this.tpState = "levitate";
    // their throw usually ends the levitation (onThrowReleased); the extra
    // second absorbs network delay before we force the fall ourselves
    this.tpTimer = T.orb.levitateS + 1.0;

    // …zapp in
    const ts = toScreen(x, d, h + 1);
    flash(this.scene, ts.sx, ts.sy, 44);
    burst(this.scene, ts.sx, ts.sy, 36, ZAP, 300);
    playSfx(this.scene, "sfx_pop", 0.8);
  }

  /** Their levitation throw arrived — falling starts now, like ours. */
  onThrowReleased() {
    if (this.tpState === "levitate") this.startFall();
  }

  update(dt: number, light?: LightDir) {
    if (light) this.light = light;

    if (this.tpState === "levitate") {
      this.airH -= T.tp.sinkSpeedM * dt;
      this.tpTimer -= dt;
      if (this.tpTimer <= 0) this.startFall();
    } else if (this.tpState === "fall") {
      this.fallV += T.throw.gravityM * dt;
      this.airH -= this.fallV * dt;
      this.d += (this.returnD - this.d) * Math.min(1, 4 * dt);
      if (this.airH <= 0) {
        this.airH = 0;
        this.d = this.returnD;
        this.tpState = "down";
        this.tpTimer = T.tp.lieS;
        playSfx(this.scene, "sfx_bounce", 0.6);
        this.scene.tweens.add({
          targets: this.sprite,
          angle: 90,
          duration: 240,
          ease: "Quad.easeIn",
        });
      }
    } else if (this.tpState === "down") {
      this.tpTimer -= dt;
      if (this.tpTimer <= 0) {
        this.tpState = "none";
        this.scene.tweens.add({
          targets: this.sprite,
          angle: 0,
          duration: T.tp.getUpMs,
          ease: "Back.easeOut",
        });
      }
    } else if (this.walking) {
      const dx = this.targetX - this.x;
      const dd = this.targetD - this.d;
      const dist = Math.hypot(dx, dd);
      if (dist <= T.move.arriveEps) {
        this.walking = false;
      } else {
        const step = Math.min(dist, T.move.speedM * dt);
        this.x += (dx / dist) * step;
        this.d += (dd / dist) * step;
        this.bobT += dt;
      }
    }
    this.render();
  }

  destroy() {
    this.sprite.destroy();
    this.label.destroy();
    this.shadow.destroy();
  }

  private startFall() {
    this.tpState = "fall";
    this.fallV = 0;
  }

  private render() {
    const { sx, sy } = toScreen(this.x, this.d, this.airH);
    const bob = this.walking ? Math.abs(Math.sin(this.bobT * 9)) * 3 : 0;
    this.sprite.setPosition(sx, sy - bob);
    this.sprite.setDepth(sortDepth(this.d));
    this.label.setPosition(sx, sy - bob - 68);
    this.label.setDepth(sortDepth(this.d) + 1);
    // shadow shrinks/fades with height and leans away from the sun,
    // exactly like Player's
    const li = this.light;
    const hFrac = Phaser.Math.Clamp(1 - this.airH / 6, 0.25, 1);
    this.shadow.setPosition(
      sx + shadowShift(1.0 + this.airH, li),
      floorY(this.d),
    );
    this.shadow.setScale(
      hFrac * (1 + (T.sky.shadowStretchMax - 1) * (1 - li.elev)),
      hFrac,
    );
    this.shadow.fillAlpha =
      Phaser.Math.Linear(T.sky.shadowAlphaLow, T.sky.shadowAlphaHigh, li.elev) *
      hFrac;
    this.shadow.setDepth(sortDepth(this.d) - 1);
  }
}
