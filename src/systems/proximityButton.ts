import Phaser from "phaser";

// The proximity-triggered button interactive elements share (the doc's
// "when a character is very close, a button appears"): a small bobbing
// pill anchored over the element, popped in/out as the player crosses
// the trigger distance. The OWNER decides when it's near (each element
// measures its own edge-to-edge distance) - this class only presents.

/** Buttons float above every world object (hoop tops out ≈ sortDepth 160)
 *  but below the aim preview (900). PLACEHOLDER (tune). */
export const BUTTON_DEPTH = 500;

export class ProximityButton {
  private readonly container: Phaser.GameObjects.Container;
  private readonly text: Phaser.GameObjects.Text;
  /** the pill's width - the progress dial anchors off its left edge */
  private readonly w: number;
  /** lazy radial progress dial (the jukebox's track timer) */
  private dial: Phaser.GameObjects.Graphics | null = null;
  private shown = false;
  /** the in-flight show/hide transition - killed on every state flip so
   *  flips queued on a sleeping tab can't fight each other on wake (a
   *  stale hide's onComplete would setVisible(false) after a show; see
   *  upgradeButton.ts, same fix) */
  private fade: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Phaser.Scene,
    sx: number,
    sy: number,
    label: string,
    onPress: () => void,
  ) {
    const text = scene.add
      .text(0, 0, label, {
        fontFamily: "monospace",
        fontSize: "13px",
        fontStyle: "bold",
        color: "#fdf6e3",
      })
      .setOrigin(0.5);
    this.text = text;
    const w = Math.max(64, text.width + 24);
    this.w = w;
    const h = 26;
    const g = scene.add.graphics();
    g.fillStyle(0x3a76c4, 0.95).fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    g.lineStyle(2, 0xfdf6e3, 0.9).strokeRoundedRect(-w / 2, -h / 2, w, h, 8);

    this.container = scene.add
      .container(sx, sy, [g, text])
      .setDepth(BUTTON_DEPTH)
      .setVisible(false)
      .setAlpha(0);
    this.container.setSize(w, h);
    // Container hit tests add displayOrigin (= size·0.5) to the local
    // point, so the hitArea rect lives in TOP-LEFT space: (0,0,w,h) is
    // the centered w×h box. A (-w/2,-h/2) rect only catches the
    // top-left quadrant.
    this.container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, w, h),
      Phaser.Geom.Rectangle.Contains,
    );
    (this.container.input as Phaser.Types.Input.InteractiveObject).cursor =
      "pointer";
    this.container.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) onPress();
    });

    scene.tweens.add({
      targets: this.container,
      y: sy - 5,
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  /** Swap the label in place (the jukebox's play/pause toggle). The pill
   *  keeps its size - meant for same-width glyph labels. */
  setLabel(label: string) {
    if (this.text.text !== label) this.text.setText(label);
  }

  /**
   * A half-transparent radial dial hugging the pill's left edge (the
   * jukebox's track timer, owner 2026-07-19): `frac` 0..1 is the
   * elapsed fraction - the bright pie shows what REMAINS; null clears
   * it. A child of the container, so it pops, bobs and hides with the
   * button - the dial only ever shows while the button itself does.
   */
  setProgress(frac: number | null) {
    if (frac === null) {
      this.dial?.clear();
      return;
    }
    if (!this.dial) {
      this.dial = this.container.scene.add.graphics();
      this.container.add(this.dial);
    }
    const d = this.dial;
    d.clear();
    const cx = -this.w / 2 - 13;
    const cy = 0;
    const r = 8;
    d.fillStyle(0x2a1020, 0.5).fillCircle(cx, cy, r + 2.5);
    // clamped shy of a full turn (a 2π slice renders as nothing) and
    // skipped once spent
    const remaining = Math.min(0.999, Math.max(0, 1 - frac));
    if (remaining > 0.002) {
      d.fillStyle(0xffd97a, 0.5);
      const start = -Math.PI / 2;
      d.slice(cx, cy, r, start, start + remaining * Math.PI * 2, false);
      d.fillPath();
    }
    d.lineStyle(1.5, 0xfdf6e3, 0.45).strokeCircle(cx, cy, r + 2.5);
  }

  /** Show/hide with a pop as the player crosses the trigger distance. */
  setNear(near: boolean) {
    if (near === this.shown) return;
    this.shown = near;
    const c = this.container;
    const scene = c.scene;
    this.fade?.remove(); // the LAST state flip wins
    if (near) {
      c.setVisible(true).setScale(0.3).setAlpha(0);
      this.fade = scene.tweens.add({
        targets: c,
        scale: 1,
        alpha: 1,
        duration: 200,
        ease: "Back.easeOut",
      });
    } else {
      this.fade = scene.tweens.add({
        targets: c,
        scale: 0.3,
        alpha: 0,
        duration: 150,
        ease: "Cubic.easeIn",
        onComplete: () => c.setVisible(false),
      });
    }
  }

  destroy() {
    this.container.destroy();
  }
}
