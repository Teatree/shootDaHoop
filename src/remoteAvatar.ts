import Phaser from "phaser";
import { T } from "./tuning";
import { clampToCourt, floorY, sortDepth, toScreen } from "./world";
import { ensurePlayerTexture } from "./placeholders";
import { shadowShift, type LightDir } from "./sky";
import type { PlayerInfo } from "./shared/messages";

// Another player's character: animated locally from their broadcast
// move-to intents (positions are never streamed). Mirrors Player's walk
// feel — same speed, same bob — with their own shirt colour and name tag.

export class RemoteAvatar {
  x: number;
  d: number;
  /** for SpeechBubbles compatibility — remote levitation isn't synced yet */
  airH = 0;

  readonly name: string;

  private walking = false;
  private targetX = 0;
  private targetD = 0;
  private bobT = 0;
  private light: LightDir = { dx: 0, elev: 1 };

  private readonly sprite: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, info: PlayerInfo) {
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
    const c = clampToCourt(x, d);
    this.targetX = c.x;
    this.targetD = c.d;
    this.walking = true;
    this.sprite.setFlipX(c.x < this.x);
  }

  /** Snapshot reconciliation — snap without walking. */
  setPos(x: number, d: number) {
    if (this.walking) return; // mid-walk, the intent will land us right
    this.x = x;
    this.d = d;
  }

  update(dt: number, light?: LightDir) {
    if (light) this.light = light;
    if (this.walking) {
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

  private render() {
    const { sx, sy } = toScreen(this.x, this.d, 0);
    const bob = this.walking ? Math.abs(Math.sin(this.bobT * 9)) * 3 : 0;
    this.sprite.setPosition(sx, sy - bob);
    this.sprite.setDepth(sortDepth(this.d));
    this.label.setPosition(sx, sy - bob - 68);
    this.label.setDepth(sortDepth(this.d) + 1);
    const li = this.light;
    this.shadow.setPosition(sx + shadowShift(1.0, li), floorY(this.d));
    this.shadow.setScale(1 + (T.sky.shadowStretchMax - 1) * (1 - li.elev), 1);
    this.shadow.fillAlpha = Phaser.Math.Linear(
      T.sky.shadowAlphaLow,
      T.sky.shadowAlphaHigh,
      li.elev,
    );
    this.shadow.setDepth(sortDepth(this.d) - 1);
  }
}
