import Phaser from "phaser";
import { T } from "./tuning";
import { FREE_THROW_X, RIM, clampToCourt, floorY, sortDepth, toScreen } from "./world";
import { shadowShift, type LightDir } from "./sky";

export class Player {
  // court position, meters — spawn at the free-throw spot, but never
  // inside the hoop's keep-out zone
  x = clampToCourt(FREE_THROW_X, RIM.d).x;
  d = RIM.d;
  /** Feet height above the floor — non-zero while teleport-levitating/falling. */
  airH = 0;
  /** What the player may do: walking needs "full", aiming needs ≥ "throwOnly". */
  control: "full" | "throwOnly" | "none" = "full";

  aiming = false;

  private walking = false;
  private targetX = 0;
  private targetD = 0;
  private bobT = 0;
  private light: LightDir = { dx: 0, elev: 1 }; // neutral until the sky reports

  readonly sprite: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, name: string) {
    this.shadow = scene.add.ellipse(0, 0, 26, 8, 0x000000, 0.22);
    this.sprite = scene.add.image(0, 0, "player").setOrigin(0.5, 1);
    this.label = scene.add
      .text(0, 0, name, {
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: "11px",
        fontStyle: "bold",
        color: "#6ac48a",
      })
      .setOrigin(0.5, 1)
      .setAlpha(0.65)
      .setResolution(2); // keep the small text legible under pixelArt
    this.render();
  }

  /** Left-click: set an (x, d) floor destination. Ignored while aiming. */
  walkTo(x: number, d: number) {
    if (this.aiming || this.control !== "full") return;
    const c = clampToCourt(x, d);
    this.targetX = c.x;
    this.targetD = c.d;
    this.walking = true;
    this.sprite.setFlipX(c.x < this.x); // face travel direction
  }

  stop() {
    this.walking = false;
  }

  /** Right-click pressed: plant into the shooting stance immediately. */
  enterStance() {
    this.stop();
    this.aiming = true;
    this.sprite.setFlipX(false); // square up to the hoop (always right)
  }

  exitStance() {
    this.aiming = false;
  }

  /** Everything a ghost recording needs to redraw this exact frame. */
  visualState() {
    // mirrors render()'s bob/crouch math exactly
    const bob = this.walking ? Math.abs(Math.sin(this.bobT * 9)) * 3 : 0;
    const crouch = this.aiming ? 2 : 0;
    return {
      x: this.x,
      d: this.d,
      airH: this.airH,
      yOff: -bob + crouch,
      flipX: this.sprite.flipX,
      angle: this.sprite.angle,
    };
  }

  /** Where the ball leaves the hands. */
  releasePoint() {
    return {
      x: this.x + T.throw.releaseForwardM,
      d: this.d,
      h: this.airH + T.throw.releaseHeightM,
    };
  }

  update(dt: number, light?: LightDir) {
    if (light) this.light = light;
    if (this.walking && !this.aiming) {
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

  private render() {
    const { sx, sy } = toScreen(this.x, this.d, this.airH);
    // tiny walk bob so the placeholder doesn't glide like a statue
    const bob = this.walking ? Math.abs(Math.sin(this.bobT * 9)) * 3 : 0;
    // aiming stance: a slight crouch
    const crouch = this.aiming ? 2 : 0;
    this.sprite.setPosition(sx, sy - bob + crouch);
    this.sprite.setDepth(sortDepth(this.d));
    this.label.setPosition(sx, sy - bob + crouch - 68);
    this.label.setDepth(sortDepth(this.d) + 1);
    // drop shadow leans away from the dominant sun (caster ≈ body midpoint,
    // higher while levitating); shrinks and fades with altitude like the ball
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
