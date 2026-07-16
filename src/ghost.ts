import Phaser from "phaser";
import { T } from "./tuning";
import { M, floorY, multiplyTint, sortDepth, toScreen } from "./world";
import { floatText } from "./juice";
import { buildBubble } from "./speech";
import { CharacterRig, type RigLook } from "./characterRig";
import { FIGURE_H } from "./shared/pose";

// Ghost Records: every throw is recorded as raw per-frame samples - the
// player (plus the teleport orb and any speech bubble they could see) from
// T.ghost.preRollS before the release, the ball from release until the
// hit/miss plus T.ghost.postRollS of aftermath. Teleport slams rewind
// further: T.ghost.slamPreRollS before the ORB HIT, so the observer sees
// the whole power-up play. Clicking the throw's log line replays the
// samples with 50%-alpha ghosts on the court. Replaying data (not
// re-simulating) guarantees the recording looks EXACTLY like the original:
// the physics integrator is frame-timing dependent, so a re-simulation
// could resolve differently.
//
// The aim indicator is never recorded, so it never appears in a replay.

import {
  lerpBall,
  lerpFrame,
  sampleAt,
  type FrameSample,
  type ThrowRecording,
} from "./ghostData";

// data types + interpolation live in ghostData.ts (pure, unit-testable);
// re-exported so consumers keep one import site
export * from "./ghostData";

interface Ghosts {
  rec: ThrowRecording;
  t: number;
  player: CharacterRig;
  label: Phaser.GameObjects.Text;
  pShadow: Phaser.GameObjects.Ellipse;
  ball: Phaser.GameObjects.Image;
  bShadow: Phaser.GameObjects.Ellipse;
  orbGlow: Phaser.GameObjects.Arc;
  orbCore: Phaser.GameObjects.Arc;
  bubble: Phaser.GameObjects.Container | null;
  bubbleText: string | null;
  ballShown: boolean;
  outcomeFired: boolean;
  catchFired: boolean;
  zapFired: boolean;
  fading: boolean;
}

export class GhostPlayback {
  private g: Ghosts | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    /** the recorded player's look - recordings are always OWN throws */
    private readonly look: RigLook,
    /** fired at the recording's hit moment so the scene can snap the net */
    private readonly onMade: () => void,
  ) {}

  /** Start replaying - instantly replaces any recording already playing. */
  play(rec: ThrowRecording) {
    if (rec.evicted || rec.playerSamples.length === 0) return;
    this.stop(true);

    const a = T.ghost.alpha;
    const player = new CharacterRig(this.scene, this.look);
    player.setAlpha(0); // pop in below (a scale tween would fight the mirror)
    this.scene.tweens.add({
      targets: player.container,
      alpha: a,
      duration: T.ghost.popMs,
      ease: "Cubic.easeOut",
    });
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
    const pShadow = this.scene.add.ellipse(0, 0, 44, 9, 0x000000, a * 0.2);
    const diaPx = T.throw.ballRadiusM * 2 * M;
    const ball = this.scene.add
      .image(0, 0, "ball")
      .setOrigin(0.5)
      .setAlpha(0)
      .setVisible(false);
    ball.setDisplaySize(diaPx, diaPx);
    // the upgrade recolour rule: the ghost ball wears the look STAMPED AT
    // RECORD TIME - a pre-upgrade replay keeps the old look forever.
    // Recordings are always OWN throws, so the own-ball marker rides too.
    const lookTint = multiplyTint(
      T.ballLooks[rec.ballLook ?? "classic"],
      T.ownBallMarker,
    );
    if (lookTint !== 0xffffff) ball.setTint(lookTint);
    const bShadow = this.scene.add
      .ellipse(0, 0, diaPx * 1.2, diaPx * 0.4, 0x000000, 0)
      .setVisible(false);
    // half-transparent rendition of the teleport orb (shown when recorded)
    const orbR = T.orb.radiusM * M;
    const orbGlow = this.scene.add
      .circle(0, 0, orbR * 2.1, 0x9fd0ff, 0.3 * a)
      .setVisible(false);
    const orbCore = this.scene.add
      .circle(0, 0, orbR, 0x2e7bff, 0.95 * a)
      .setVisible(false);

    // pop in (the rig fades in above - its scaleX carries the mirror)
    label.setScale(0);
    this.scene.tweens.add({
      targets: label,
      scale: 1,
      duration: T.ghost.popMs,
      ease: "Back.easeOut",
    });

    this.g = {
      rec,
      t: 0,
      player,
      label,
      pShadow,
      ball,
      bShadow,
      orbGlow,
      orbCore,
      bubble: null,
      bubbleText: null,
      ballShown: false,
      outcomeFired: false,
      catchFired: false,
      zapFired: false,
      fading: false,
    };
    this.update(0); // position immediately
  }

  /** Tear down the current replay: instantly, or with the fade-out. */
  stop(instant: boolean) {
    const g = this.g;
    if (!g) return;
    const objs: (
      | Phaser.GameObjects.GameObject & { alpha?: number }
    )[] = [
      g.player.container,
      g.label,
      g.pShadow,
      g.ball,
      g.bShadow,
      g.orbGlow,
      g.orbCore,
    ];
    if (g.bubble) objs.push(g.bubble);
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

    // player ghost (plus the orb and speech bubble they saw)
    const ps = sampleAt(rec.playerSamples, g.t, lerpFrame);
    if (ps) {
      const { sx, sy } = toScreen(ps.x, ps.d, ps.airH);
      g.player.setPosition(sx, sy);
      g.player.setFacing(ps.facing === 1);
      g.player.angle = ps.angle;
      g.player.applyPose(ps.pose, dt);
      g.player.setDepth(sortDepth(ps.d));
      g.label.setPosition(sx, sy - FIGURE_H - 9);
      g.label.setDepth(sortDepth(ps.d) + 1);
      const hFrac = Phaser.Math.Clamp(1 - ps.airH / 6, 0.25, 1);
      g.pShadow.setPosition(sx, floorY(ps.d));
      g.pShadow.setScale(hFrac);
      g.pShadow.setDepth(sortDepth(ps.d) - 1);
      this.updateOrb(g, ps);
      this.updateBubble(g, ps, sx, sy);
    }

    // ball ghost - exists only across its recorded flight window
    const bArr = rec.ballSamples;
    if (bArr.length > 0 && g.t >= bArr[0].t) {
      if (g.t <= bArr[bArr.length - 1].t) {
        const bs = sampleAt(bArr, g.t, lerpBall)!;
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
        g.ball.rotation += ((sx - prevSX) / M) * T.throw.spinRadPerM;
        g.ball.setDepth(sortDepth(bs.d) + 1);
        const hFrac = Phaser.Math.Clamp(1 - bs.h / 6, 0.25, 1);
        g.bShadow.setPosition(sx, floorY(bs.d));
        g.bShadow.setScale(hFrac);
        g.bShadow.fillAlpha = T.ghost.alpha * 0.2 * hFrac;
        g.bShadow.setDepth(sortDepth(bs.d) - 1);
      } else if (g.ballShown && g.ball.visible) {
        // the original ball popped here (rest explode / consumed) - vanish
        g.ball.setVisible(false);
        g.bShadow.setVisible(false);
      }
    }

    // the recorded teleport moment: replay the zapp at both ends
    if (!g.zapFired && rec.teleportT !== undefined && g.t >= rec.teleportT) {
      g.zapFired = true;
      if (rec.teleportFrom) this.zap(rec.teleportFrom);
      if (rec.teleportTo) this.zap(rec.teleportTo);
    }

    // the recorded hit moment: let the scene snap the real net
    if (!g.outcomeFired && rec.outcomeT !== undefined && g.t >= rec.outcomeT) {
      g.outcomeFired = true;
      if (rec.made) this.onMade();
    }

    // the recorded catch: the ball popped back to the player right here
    // (the ball samples end at the pop; this is the celebration)
    if (!g.catchFired && rec.catchT !== undefined && g.t >= rec.catchT) {
      g.catchFired = true;
      floatText(this.scene, g.ball.x, g.ball.y - 8, "CATCH!", "#6ac48a", 14);
    }

    // played out in full → fade away
    if (rec.done && rec.duration !== undefined && g.t >= rec.duration) {
      this.stop(false);
    }
  }

  private updateOrb(g: Ghosts, ps: FrameSample) {
    if (ps.orb) {
      const o = ps.orb;
      const { sx, sy } = toScreen(o.x, o.d, o.h);
      const pulse = 1 + 0.12 * Math.sin(o.age * Math.PI * 2 * T.tp.pulseHz);
      const depth = sortDepth(o.d);
      g.orbGlow
        .setVisible(true)
        .setPosition(sx, sy)
        .setScale(pulse * 1.15)
        .setDepth(depth - 1);
      g.orbCore.setVisible(true).setPosition(sx, sy).setScale(pulse).setDepth(depth);
    } else {
      g.orbGlow.setVisible(false);
      g.orbCore.setVisible(false);
    }
  }

  private updateBubble(g: Ghosts, ps: FrameSample, sx: number, sy: number) {
    const text = ps.bubble?.text ?? null;
    if (text !== g.bubbleText) {
      g.bubble?.destroy();
      g.bubble = null;
      g.bubbleText = text;
      if (text !== null) {
        g.bubble = buildBubble(this.scene, text);
        g.bubble.setAlpha(T.ghost.alpha);
        if ((ps.bubble?.age ?? 1) < 0.3) {
          // freshly said in the recording - replay the pop
          g.bubble.setScale(0.3);
          this.scene.tweens.add({
            targets: g.bubble,
            scale: 1,
            duration: T.speech.appearMs,
            ease: "Back.easeOut",
          });
        }
      }
    }
    if (g.bubble && ps.bubble) {
      const s = T.speech;
      const age = ps.bubble.age;
      g.bubble.x = sx;
      g.bubble.y =
        sy - s.gapAbovePx + Math.sin(age * Math.PI * 2 * s.bobHz) * s.bobPx;
      g.bubble.rotation = Math.sin(age * Math.PI * 2 * s.bobHz * 0.8) * s.swayRad;
      g.bubble.setDepth(sortDepth(ps.d) + 2);
    }
  }

  /** Half-strength blue zapp burst - the ghost of the teleport effect. */
  private zap(at: { x: number; d: number; h: number }) {
    const { sx, sy } = toScreen(at.x, at.d, at.h + 1);
    const ring = this.scene.add
      .circle(sx, sy, 26, 0x9fd0ff, 0.35)
      .setDepth(1400);
    this.scene.tweens.add({
      targets: ring,
      scale: 1.8,
      alpha: 0,
      duration: 300,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
    const em = this.scene.add
      .particles(sx, sy, "px", {
        speed: { min: 80, max: 220 },
        angle: { min: 0, max: 360 },
        lifespan: 400,
        scale: { start: 1.1, end: 0 },
        alpha: { start: T.ghost.alpha, end: 0 },
        tint: [0x2e7bff, 0x9fd0ff, 0xffffff],
        emitting: false,
      })
      .setDepth(1400);
    em.explode(14);
    this.scene.time.delayedCall(600, () => em.destroy());
  }
}
