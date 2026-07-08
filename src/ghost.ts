import Phaser from "phaser";
import { T } from "./tuning";
import { floorY, sortDepth, toScreen } from "./world";

// Ghost Records: every throw is recorded as raw per-frame samples — the
// player from T.ghost.preRollS before the release, the ball from release
// until the hit/miss plus T.ghost.postRollS of aftermath. Clicking the
// throw's log line replays those samples with 50%-alpha ghosts on the
// court. Replaying data (not re-simulating) guarantees the recording looks
// EXACTLY like the original: the physics integrator is frame-timing
// dependent, so a re-simulation could resolve differently.
//
// The aim indicator is never recorded, so it never appears in a replay.

export interface PlayerSample {
  t: number; //  seconds since recording start
  x: number; //  court meters
  d: number;
  airH: number;
  yOff: number; // walk-bob / aim-crouch pixel offset (pre-baked)
  flipX: boolean;
  angle: number;
}

export interface BallSample {
  t: number;
  x: number;
  d: number;
  h: number;
}

export interface ThrowRecording {
  name: string;
  playerSamples: PlayerSample[];
  ballSamples: BallSample[];
  outcomeT?: number; //  when the hit/miss happened (recording time)
  made?: boolean;
  duration?: number; //  outcomeT + postRollS, set when finalized
  done: boolean;
  evicted: boolean; //   samples dropped to bound memory — unplayable
}

/** Linear interpolation over a time-sorted sample array. */
function sampleAt<S extends { t: number }>(
  arr: S[],
  t: number,
  lerp: (a: S, b: S, f: number) => S,
): S | null {
  if (arr.length === 0 || t < arr[0].t) return null;
  if (t >= arr[arr.length - 1].t) return arr[arr.length - 1];
  // arrays are a few hundred entries; a scan is fine at 60fps
  let i = 0;
  while (arr[i + 1].t < t) i++;
  const a = arr[i];
  const b = arr[i + 1];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return lerp(a, b, f);
}

const lerpP = (a: PlayerSample, b: PlayerSample, f: number): PlayerSample => ({
  t: 0,
  x: Phaser.Math.Linear(a.x, b.x, f),
  d: Phaser.Math.Linear(a.d, b.d, f),
  airH: Phaser.Math.Linear(a.airH, b.airH, f),
  yOff: Phaser.Math.Linear(a.yOff, b.yOff, f),
  flipX: f < 0.5 ? a.flipX : b.flipX,
  angle: Phaser.Math.Linear(a.angle, b.angle, f),
});

const lerpB = (a: BallSample, b: BallSample, f: number): BallSample => ({
  t: 0,
  x: Phaser.Math.Linear(a.x, b.x, f),
  d: Phaser.Math.Linear(a.d, b.d, f),
  h: Phaser.Math.Linear(a.h, b.h, f),
});

interface Ghosts {
  rec: ThrowRecording;
  t: number;
  player: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  pShadow: Phaser.GameObjects.Ellipse;
  ball: Phaser.GameObjects.Image;
  bShadow: Phaser.GameObjects.Ellipse;
  ballShown: boolean;
  outcomeFired: boolean;
  fading: boolean;
}

export class GhostPlayback {
  private g: Ghosts | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    /** fired at the recording's hit moment so the scene can snap the net */
    private readonly onMade: () => void,
  ) {}

  /** Start replaying — instantly replaces any recording already playing. */
  play(rec: ThrowRecording) {
    if (rec.evicted || rec.playerSamples.length === 0) return;
    this.stop(true);

    const a = T.ghost.alpha;
    const player = this.scene.add
      .image(0, 0, "player")
      .setOrigin(0.5, 1)
      .setAlpha(a);
    const label = this.scene.add
      .text(0, 0, rec.name, {
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: "11px",
        fontStyle: "bold",
        color: "#6ac48a",
      })
      .setOrigin(0.5, 1)
      .setAlpha(a * 0.65)
      .setResolution(2);
    const pShadow = this.scene.add.ellipse(0, 0, 26, 8, 0x000000, a * 0.2);
    const diaPx = T.throw.ballRadiusM * 2 * 32;
    const ball = this.scene.add
      .image(0, 0, "ball")
      .setOrigin(0.5)
      .setAlpha(0)
      .setVisible(false);
    ball.setDisplaySize(diaPx, diaPx);
    const bShadow = this.scene.add
      .ellipse(0, 0, diaPx * 1.2, diaPx * 0.4, 0x000000, 0)
      .setVisible(false);

    // pop in
    for (const obj of [player, label]) {
      const target = obj.scale;
      obj.setScale(0);
      this.scene.tweens.add({
        targets: obj,
        scale: target,
        duration: T.ghost.popMs,
        ease: "Back.easeOut",
      });
    }

    this.g = {
      rec,
      t: 0,
      player,
      label,
      pShadow,
      ball,
      bShadow,
      ballShown: false,
      outcomeFired: false,
      fading: false,
    };
    this.update(0); // position immediately
  }

  /** Tear down the current replay: instantly, or with the fade-out. */
  stop(instant: boolean) {
    const g = this.g;
    if (!g) return;
    const objs = [g.player, g.label, g.pShadow, g.ball, g.bShadow];
    if (instant) {
      for (const o of objs) o.destroy();
      this.g = null;
    } else {
      if (g.fading) return;
      g.fading = true;
      this.scene.tweens.add({
        targets: objs,
        alpha: 0,
        duration: T.ghost.fadeMs,
        ease: "Cubic.easeIn",
        onComplete: () => {
          for (const o of objs) o.destroy();
          if (this.g === g) this.g = null;
        },
      });
    }
  }

  update(dt: number) {
    const g = this.g;
    if (!g || g.fading) return;
    g.t += dt;
    const rec = g.rec;

    // player ghost
    const ps = sampleAt(rec.playerSamples, g.t, lerpP);
    if (ps) {
      const { sx, sy } = toScreen(ps.x, ps.d, ps.airH);
      g.player.setPosition(sx, sy + ps.yOff);
      g.player.setFlipX(ps.flipX);
      g.player.setAngle(ps.angle);
      g.player.setDepth(sortDepth(ps.d));
      g.label.setPosition(sx, sy + ps.yOff - 68);
      g.label.setDepth(sortDepth(ps.d) + 1);
      const hFrac = Phaser.Math.Clamp(1 - ps.airH / 6, 0.25, 1);
      g.pShadow.setPosition(sx, floorY(ps.d));
      g.pShadow.setScale(hFrac);
      g.pShadow.setDepth(sortDepth(ps.d) - 1);
    }

    // ball ghost — exists only across its recorded flight window
    const bArr = rec.ballSamples;
    if (bArr.length > 0 && g.t >= bArr[0].t) {
      if (g.t <= bArr[bArr.length - 1].t) {
        const bs = sampleAt(bArr, g.t, lerpB)!;
        if (!g.ballShown) {
          g.ballShown = true;
          g.ball.setVisible(true).setAlpha(T.ghost.alpha);
          g.bShadow.setVisible(true);
          const target = g.ball.scale;
          g.ball.setScale(target * 0.3);
          this.scene.tweens.add({
            targets: g.ball,
            scale: target,
            duration: T.ghost.popMs,
            ease: "Back.easeOut",
          });
        }
        const prevSX = g.ball.x;
        const { sx, sy } = toScreen(bs.x, bs.d, bs.h);
        g.ball.setPosition(sx, sy);
        g.ball.rotation += ((sx - prevSX) / 32) * T.throw.spinRadPerM;
        g.ball.setDepth(sortDepth(bs.d) + 1);
        const hFrac = Phaser.Math.Clamp(1 - bs.h / 6, 0.25, 1);
        g.bShadow.setPosition(sx, floorY(bs.d));
        g.bShadow.setScale(hFrac);
        g.bShadow.fillAlpha = T.ghost.alpha * 0.2 * hFrac;
        g.bShadow.setDepth(sortDepth(bs.d) - 1);
      } else if (g.ballShown && g.ball.visible) {
        // the original ball popped here (rest explode / consumed) — vanish
        g.ball.setVisible(false);
        g.bShadow.setVisible(false);
      }
    }

    // the recorded hit moment: let the scene snap the real net
    if (!g.outcomeFired && rec.outcomeT !== undefined && g.t >= rec.outcomeT) {
      g.outcomeFired = true;
      if (rec.made) this.onMade();
    }

    // played out in full → fade away
    if (rec.done && rec.duration !== undefined && g.t >= rec.duration) {
      this.stop(false);
    }
  }
}
