import Phaser from "phaser";
import { T } from "./tuning";
import { sortDepth, toScreen } from "./world";

/** Anything a bubble can hang above - the local Player or a RemoteAvatar. */
export interface BubbleAnchor {
  x: number;
  d: number;
  airH: number;
}

// Chat speech bubbles: one at a time above the player (over the name),
// sized to the text, popping in, hanging with a gentle idle bob for
// T.speech.holdS seconds, then fading out. Messages sent while one is
// showing wait in a FIFO queue and get the same treatment.

interface ActiveBubble {
  container: Phaser.GameObjects.Container;
  text: string;
  age: number;
  fading: boolean;
}

/**
 * Build a bubble (body + tail + text) around origin = tail tip. Shared by
 * live chat and ghost replays.
 */
export function buildBubble(
  scene: Phaser.Scene,
  text: string,
): Phaser.GameObjects.Container {
  const s = T.speech;
  const txt = scene.add
    .text(0, 0, text, {
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: "12px",
      fontStyle: "bold",
      color: "#2b1e16",
      wordWrap: { width: s.wrapPx, useAdvancedWrap: true },
    })
    .setResolution(2);
  const w = txt.width + s.padPx * 2;
  const h = txt.height + s.padPx * 2;

  const g = scene.add.graphics();
  g.fillStyle(0xfff6e0, 0.95).fillRoundedRect(-w / 2, -h - 8, w, h, 6);
  g.lineStyle(2, 0x5a3d28, 1).strokeRoundedRect(-w / 2, -h - 8, w, h, 6);
  g.fillStyle(0xfff6e0, 0.95).fillTriangle(-6, -9, 6, -9, 0, 0);
  g.lineStyle(2, 0x5a3d28, 1);
  g.beginPath();
  g.moveTo(-6, -8);
  g.lineTo(0, 0);
  g.lineTo(6, -8);
  g.strokePath();
  txt.setPosition(-w / 2 + s.padPx, -h - 8 + s.padPx);

  return scene.add.container(0, 0, [g, txt]);
}

export class SpeechBubbles {
  private queue: string[] = [];
  private active: ActiveBubble | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: BubbleAnchor,
  ) {}

  say(text: string) {
    const msg = text.slice(0, T.speech.maxChars);
    if (!msg) return;
    this.queue.push(msg);
    if (!this.active) this.showNext();
  }

  /** What's on screen right now - sampled by ghost recordings. */
  current(): { text: string; age: number } | null {
    const a = this.active;
    return a && !a.fading ? { text: a.text, age: a.age } : null;
  }

  update(dt: number) {
    const a = this.active;
    if (!a) return;
    a.age += dt;

    // follow the player, hanging above the name label, with an idle bob
    const { sx, sy } = toScreen(this.player.x, this.player.d, this.player.airH);
    const s = T.speech;
    a.container.x = sx;
    a.container.y =
      sy - s.gapAbovePx + Math.sin(a.age * Math.PI * 2 * s.bobHz) * s.bobPx;
    a.container.rotation = Math.sin(a.age * Math.PI * 2 * s.bobHz * 0.8) * s.swayRad;
    a.container.setDepth(sortDepth(this.player.d) + 2);

    if (!a.fading && a.age >= s.holdS) {
      a.fading = true;
      this.scene.tweens.add({
        targets: a.container,
        alpha: 0,
        y: a.container.y - 10,
        duration: s.fadeMs,
        ease: "Cubic.easeIn",
        onComplete: () => {
          a.container.destroy();
          this.active = null;
          this.showNext();
        },
      });
    }
  }

  private showNext() {
    const msg = this.queue.shift();
    if (msg === undefined) return;

    const container = buildBubble(this.scene, msg);
    container.setScale(0.3).setAlpha(0);
    this.scene.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: T.speech.appearMs,
      ease: "Back.easeOut",
    });

    this.active = { container, text: msg, age: 0, fading: false };
    this.update(0); // position immediately, no one-frame pop at (0,0)
  }
}
