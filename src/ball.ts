import Phaser from "phaser";
import { T } from "./tuning";
import { M, RIM, WALL_LEFT_X, WALL_RIGHT_X, floorY, sortDepth, toScreen } from "./world";
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

// A thrown ball. Physics resolve in the shooting plane (x = toward the
// hoop, h = height); depth (d) eases toward the rim's lane during flight.
export class Ball {
  private x: number;
  private d: number;
  private h: number;
  private vx: number;
  private vh: number;

  private scored = false;
  private rimTouched = false;
  private resolved = false; // miss/score reported
  private resting = false;
  private restT = 0;
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
    this.x = opts.x;
    this.d = opts.d;
    this.h = opts.h;
    this.vx = opts.vx;
    this.vh = opts.vh;

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
    this.trail.setDepth(sortDepth(this.d) - 2);

    playSfx(scene, "sfx_throw", 0.8);
    this.render();
  }

  /** True once fully cleaned up — the scene drops it from its list. */
  get done(): boolean {
    return this.dead;
  }

  /** Current court position (meters) — for power-up overlap checks. */
  get pos() {
    return { x: this.x, d: this.d, h: this.h };
  }

  /** Absorbed by a power-up: no hit/miss callback, just the pop. */
  consume() {
    if (this.dead) return;
    this.resolved = true;
    this.explode();
  }

  update(dt: number, light?: LightDir) {
    if (light) this.light = light;
    if (this.dead) return;
    this.life += dt;

    if (this.resting) {
      this.vx *= Math.exp(-6 * dt);
      this.x += this.vx * dt;
      this.restT += dt;
      if (this.restT >= T.ground.restDelayS) this.explode();
      this.render();
      return;
    }

    // ── flight integration (shooting plane), substepped ─────────────
    // Cap travel per substep to a fraction of the ball radius so fast
    // shots can't teleport into (or through) the rim between frames —
    // scoring and rim contact are decided by the swept path, not by
    // whatever position a full frame step happens to land on.
    const speed = Math.hypot(this.vx, this.vh);
    const maxTravel = T.throw.substepTravelFrac * T.throw.ballRadiusM;
    const steps = Phaser.Math.Clamp(
      Math.ceil((speed * dt) / maxTravel),
      1,
      T.throw.maxSubsteps,
    );
    const sdt = dt / steps;

    for (let i = 0; i < steps && !this.resting && !this.dead; i++) {
      const prevX = this.x;
      const prevH = this.h;

      this.vh -= T.throw.gravityM * sdt;
      this.x += this.vx * sdt;
      this.h += this.vh * sdt;
      // depth converges on the rim's lane so the shot reads on the hoop
      this.d += (RIM.d - this.d) * Math.min(1, T.throw.depthEaseRate * sdt);

      // only interact with the hoop when we're in its lane
      if (Math.abs(this.d - RIM.d) < T.hoop.laneDepthM) {
        this.collideRimPoint(RIM.x - RIM.r, RIM.h);
        this.collideRimPoint(RIM.x + RIM.r, RIM.h);
        this.collideBackboard(prevX);
        this.checkScore(prevX, prevH);
      }

      this.collideWall();
      this.stepGround();
    }

    // safety despawns (somehow past a wall / stuck)
    if (
      this.life > T.ground.maxLifeS ||
      this.x < WALL_LEFT_X - 2 ||
      this.x > WALL_RIGHT_X + 2
    ) {
      if (!this.resolved) {
        this.resolved = true;
        this.opts.onMiss(this.outcome(false));
      }
      this.explode();
      return;
    }

    this.render();
  }

  private outcome(made: boolean): ShotOutcome {
    return { made, swish: made && !this.rimTouched, distM: this.opts.shotDistM };
  }

  /**
   * Swept scoring: the segment travelled this substep must cross the rim
   * plane (h = RIM.h) downward, and the interpolated crossing point must
   * fit the opening with the FULL ball radius — physics decides, not
   * whichever position the frame happened to sample.
   */
  private checkScore(prevX: number, prevH: number) {
    if (this.scored || this.vh >= 0) return;
    if (!(prevH > RIM.h && this.h <= RIM.h)) return;
    const tCross = (prevH - RIM.h) / (prevH - this.h);
    const xCross = prevX + (this.x - prevX) * tCross;
    if (Math.abs(xCross - RIM.x) >= RIM.r - T.throw.ballRadiusM) return;
    if (Math.abs(this.d - RIM.d) >= T.hoop.scoreDepthM) return;

    this.scored = true;
    this.resolved = true;
    // net drag
    this.vx *= 0.25;
    this.vh *= 0.55;
    this.opts.onScore(this.outcome(true));
  }

  private stepGround() {
    const r = T.throw.ballRadiusM;
    if (this.h <= r && this.vh < 0) {
      this.h = r;
      if (!this.resolved) {
        // once it hits the floor it can't score — call the miss now
        this.resolved = true;
        this.opts.onMiss(this.outcome(false));
      }
      this.vh = -this.vh * T.ground.restitution;
      this.vx *= T.ground.slideFriction;
      playSfx(this.scene, "sfx_bounce", 0.4);
      if (this.vh < T.ground.restSpeedM) {
        this.vh = 0;
        this.resting = true;
      }
    }
  }

  /** Circle-vs-point bounce against a rim tip. */
  private collideRimPoint(px: number, ph: number) {
    const dx = this.x - px;
    const dh = this.h - ph;
    const dist = Math.hypot(dx, dh);
    const minDist = T.throw.ballRadiusM + 0.02;
    if (dist === 0 || dist >= minDist) return;
    const nx = dx / dist;
    const nh = dh / dist;
    const vDotN = this.vx * nx + this.vh * nh;
    if (vDotN < 0) {
      const e = T.hoop.rimRestitution;
      this.vx -= (1 + e) * vDotN * nx;
      this.vh -= (1 + e) * vDotN * nh;
    }
    // push out of penetration
    this.x = px + nx * minDist;
    this.h = ph + nh * minDist;
    this.rimTouched = true;
    this.playRimSfx(0.6);
  }

  private playRimSfx(vol: number) {
    if (this.life - this.lastRimSfxAt < 0.05) return;
    this.lastRimSfxAt = this.life;
    playSfx(this.scene, "sfx_rim", vol);
  }

  /** Boundary walls past both baselines — the physical scene edges. */
  private collideWall() {
    const r = T.throw.ballRadiusM;
    if (this.vx > 0 && this.x + r > WALL_RIGHT_X) {
      this.x = WALL_RIGHT_X - r;
      this.vx = -this.vx * T.wall.restitution;
      playSfx(this.scene, "sfx_bounce", 0.5);
    } else if (this.vx < 0 && this.x - r < WALL_LEFT_X) {
      this.x = WALL_LEFT_X + r;
      this.vx = -this.vx * T.wall.restitution;
      playSfx(this.scene, "sfx_bounce", 0.5);
    }
  }

  /**
   * Swept board check: the ball must CROSS the board plane during this
   * substep. A mere "is past the plane" test teleported balls that sailed
   * over the board back onto its face when they descended on the far side.
   */
  private collideBackboard(prevX: number) {
    const bx = RIM.x + RIM.r + T.hoop.boardGapM;
    const r = T.throw.ballRadiusM;
    if (
      this.vx > 0 &&
      prevX + r <= bx &&
      this.x + r > bx &&
      this.h > T.hoop.boardBottomM &&
      this.h < T.hoop.boardTopM
    ) {
      this.x = bx - r;
      this.vx = -this.vx * T.hoop.boardRestitution;
      this.rimTouched = true; // board touch also spoils the swish
      this.playRimSfx(0.5);
    }
  }

  private explode() {
    const { sx, sy } = toScreen(this.x, this.d, this.h);
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
    const { sx, sy } = toScreen(this.x, this.d, this.h);
    this.sprite.setPosition(sx, sy);
    this.sprite.rotation +=
      this.vx * T.throw.spinRadPerM * (1 / 60); // frame-ish spin, reads fine
    this.sprite.setDepth(sortDepth(this.d) + 1);

    // shadow shrinks/fades with height and leans away from the sun —
    // the higher the ball, the further its shadow slides
    const hFrac = Phaser.Math.Clamp(1 - this.h / 6, 0.25, 1);
    const li = this.light;
    this.shadow.setPosition(sx + shadowShift(this.h, li), floorY(this.d));
    this.shadow.setScale(
      hFrac * (1 + (T.sky.shadowStretchMax - 1) * (1 - li.elev)),
      hFrac,
    );
    this.shadow.setAlpha(
      Phaser.Math.Linear(T.sky.shadowAlphaLow, T.sky.shadowAlphaHigh, li.elev) *
        hFrac,
    );
    this.shadow.setDepth(sortDepth(this.d) - 1);
  }
}

/** px→meters helper for launch velocity from screen-space drag. */
export const PX_TO_M = 1 / M;
