import Phaser from "phaser";
import { T } from "./tuning";

// Cosmetic feedback helpers. All intensity knobs live in tuning.ts.

const CONFETTI = [0xffd97a, 0xff8a5a, 0x9ad1ff, 0xb0e57c, 0xff9ad5];
const BALL_BITS = [0xd2691e, 0xf0955a, 0x8a4310, 0xffd97a];

export function burst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  count: number,
  tints: readonly number[] = CONFETTI,
  speed = 220,
) {
  const em = scene.add.particles(x, y, "px", {
    speed: { min: speed * 0.35, max: speed },
    angle: { min: 0, max: 360 },
    lifespan: { min: 350, max: 750 },
    scale: { start: 1.4, end: 0 },
    gravityY: 420,
    tint: tints as number[],
    emitting: false,
  });
  em.setDepth(1500);
  em.explode(count);
  scene.time.delayedCall(1200, () => em.destroy());
}

export function ballExplode(scene: Phaser.Scene, x: number, y: number) {
  burst(scene, x, y, T.juice.explodeParticles, BALL_BITS, 160);
}

const PUFF_TINTS = [0xfff3d6, 0xf3e2c0, 0xe8d5b5];

/** A small dust puff — a character appearing on the court. */
export function puff(scene: Phaser.Scene, x: number, y: number) {
  const em = scene.add.particles(x, y - 20, "px", {
    speed: { min: 15, max: 55 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 300, max: 650 },
    scale: { start: 2.2, end: 0 },
    alpha: { start: 0.8, end: 0 },
    gravityY: -30, // smoke drifts up, not confetti-down
    tint: PUFF_TINTS as number[],
    emitting: false,
  });
  em.setDepth(1400);
  em.explode(14);
  scene.time.delayedCall(900, () => em.destroy());
}

export function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  color = "#ffd97a",
  size = 18,
) {
  const t = scene.add
    .text(x, y, str, {
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: `${size}px`,
      fontStyle: "bold",
      color,
      stroke: "#5a3d28",
      strokeThickness: 4,
    })
    .setOrigin(0.5, 1)
    .setDepth(2000)
    .setScale(0.4);

  scene.tweens.add({
    targets: t,
    scale: 1,
    duration: 120,
    ease: "Back.easeOut",
  });
  scene.tweens.add({
    targets: t,
    y: y - T.juice.floatTextRisePx,
    alpha: 0,
    delay: 150,
    duration: T.juice.floatTextMs,
    ease: "Cubic.easeOut",
    onComplete: () => t.destroy(),
  });
}

export function flash(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius = 26,
  color = 0xfff3d6,
) {
  const c = scene.add.circle(x, y, radius, color, 0.85).setDepth(1400);
  scene.tweens.add({
    targets: c,
    scale: 2.4,
    alpha: 0,
    duration: 260,
    ease: "Cubic.easeOut",
    onComplete: () => c.destroy(),
  });
}

export function netSnap(scene: Phaser.Scene, net: Phaser.GameObjects.Graphics) {
  scene.tweens.chain({
    targets: net,
    tweens: [
      { scaleY: 1.7, scaleX: 0.85, duration: 90, ease: "Cubic.easeOut" },
      {
        scaleY: 1,
        scaleX: 1,
        duration: T.juice.netSnapMs,
        ease: "Elastic.easeOut",
      },
    ],
  });
}
