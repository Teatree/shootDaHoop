import Phaser from "phaser";
import { T } from "./tuning";
import { M, WALL_LEFT_X, WALL_RIGHT_X, floorY, sortDepth, toScreen } from "./world";
import { type BallState, createBallState, stepBall } from "./physics";
import { ballExplode } from "./juice";
import { playSfx } from "./sfx";
import { shadowShift, type LightDir } from "./sky";

export interface ShotOutcome {
  made: boolean;
  swish: boolean; // made without touching the rim
  distM: number; //  floor distance the shot was taken from
}

interface BallOpts {
  x: number;
  d: number;
  h: number;
  vx: number;
  vh: number;
  shotDistM: number;
  onScore: (o: ShotOutcome) => void;
  onMiss: (o: ShotOutcome) => void;
  onDone: (ball: Ball) => void;
}

// A thrown ball: the Phaser face (sprite, shadow, trail, sfx, callbacks)
// over the pure physics stepper in physics.ts.
export class Ball {
  private readonly s: BallState;

  private life = 0;
  private dead = false;
  private lastRimSfxAt = -1; // substeps can rattle many times per frame
  private light: LightDir = { dx: 0, elev: 1 };

  private readonly sprite: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly trail: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: BallOpts,
  ) {
    this.s = createBallState(opts.x, opts.d, opts.h, opts.vx, opts.vh);

    // physics size == visual size, whatever texture is loaded
    const diaPx = T.throw.ballRadiusM * 2 * M;
    this.shadow = scene.add.ellipse(
      0,
      0,
      diaPx * 1.2,
      diaPx * 0.4,
      0x000000,
      0.2,
    );
    this.sprite = scene.add.image(0, 0, "ball").setOrigin(0.5);
    this.sprite.setDisplaySize(diaPx, diaPx);
    const baseScale = this.sprite.scaleX;

    // release "pop" — tween back to baseScale, NOT 1, or it undoes the sizing
    this.sprite.setScale(baseScale * T.throw.releasePopScale);
    scene.tweens.add({
      targets: this.sprite,
      scale: baseScale,
      duration: T.throw.releasePopMs,
      ease: "Cubic.easeOut",
    });

    // subtle motion trail
    this.trail = scene.add.particles(0, 0, "px", {
      follow: this.sprite,
      frequency: T.throw.trail.frequencyMs,
      lifespan: T.throw.trail.lifespanMs,
      alpha: { start: T.throw.trail.alpha, end: 0 },
      scale: { start: 2.2, end: 0.3 },
      tint: 0xf0955a,
      speed: 4,
    });
    this.trail.setDepth(sortDepth(this.s.d) - 2);

    playSfx(scene, "sfx_throw", 0.8);
    this.render();
  }

  /** True once fully cleaned up — the scene drops it from its list. */
  get done(): boolean {
    return this.dead;
  }

  /** Current court position (meters) — for power-up overlap checks. */
  get pos() {
    return { x: this.s.x, d: this.s.d, h: this.s.h };
  }

  /** Absorbed by a power-up: no hit/miss callback, just the pop. */
  consume() {
    if (this.dead) return;
    this.s.resolved = true;
    this.explode();
  }

  update(dt: number, light?: LightDir) {
    if (light) this.light = light;
    if (this.dead) return;
    this.life += dt;

    for (const e of stepBall(this.s, dt)) {
      switch (e) {
        case "score":
          this.opts.onScore(this.outcome(true));
          break;
        case "miss":
          this.opts.onMiss(this.outcome(false));
          break;
        case "rim":
          this.playRimSfx(0.6);
          break;
        case "board":
          this.playRimSfx(0.5);
          break;
        case "wall":
        case "bounce":
          playSfx(this.scene, "sfx_bounce", e === "wall" ? 0.5 : 0.4);
          break;
        case "restDone":
          this.explode();
          return;
      }
    }

    // safety despawns (somehow past a wall / stuck)
    if (
      this.life > T.ground.maxLifeS ||
      this.s.x < WALL_LEFT_X - 2 ||
      this.s.x > WALL_RIGHT_X + 2
    ) {
      if (!this.s.resolved) {
        this.s.resolved = true;
        this.opts.onMiss(this.outcome(false));
      }
      this.explode();
      return;
    }

    this.render();
  }

  private outcome(made: boolean): ShotOutcome {
    return {
      made,
      swish: made && !this.s.rimTouched,
      distM: this.opts.shotDistM,
    };
  }

  private playRimSfx(vol: number) {
    if (this.life - this.lastRimSfxAt < 0.05) return;
    this.lastRimSfxAt = this.life;
    playSfx(this.scene, "sfx_rim", vol);
  }

  private explode() {
    const { sx, sy } = toScreen(this.s.x, this.s.d, this.s.h);
    ballExplode(this.scene, sx, sy);
    playSfx(this.scene, "sfx_pop", 0.7);
    this.destroy();
  }

  private destroy() {
    this.dead = true;
    this.trail.destroy();
    this.sprite.destroy();
    this.shadow.destroy();
    this.opts.onDone(this);
  }

  private render() {
    const { sx, sy } = toScreen(this.s.x, this.s.d, this.s.h);
    this.sprite.setPosition(sx, sy);
    this.sprite.rotation += this.s.vx * T.throw.spinRadPerM * (1 / 60); // frame-ish spin, reads fine
    this.sprite.setDepth(sortDepth(this.s.d) + 1);

    // shadow shrinks/fades with height and leans away from the sun —
    // the higher the ball, the further its shadow slides
    const hFrac = Phaser.Math.Clamp(1 - this.s.h / 6, 0.25, 1);
    const li = this.light;
    this.shadow.setPosition(sx + shadowShift(this.s.h, li), floorY(this.s.d));
    this.shadow.setScale(
      hFrac * (1 + (T.sky.shadowStretchMax - 1) * (1 - li.elev)),
      hFrac,
    );
    this.shadow.setAlpha(
      Phaser.Math.Linear(T.sky.shadowAlphaLow, T.sky.shadowAlphaHigh, li.elev) *
        hFrac,
    );
    this.shadow.setDepth(sortDepth(this.s.d) - 1);
  }
}

/** px→meters helper for launch velocity from screen-space drag. */
export const PX_TO_M = 1 / M;
