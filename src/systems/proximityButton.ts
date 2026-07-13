import Phaser from "phaser";

// The proximity-triggered button interactive elements share (the doc's
// "when a character is very close, a button appears"): a small bobbing
// pill anchored over the element, popped in/out as the player crosses
// the trigger distance. The OWNER decides when it's near (each element
// measures its own edge-to-edge distance) — this class only presents.

export class ProximityButton {
  private readonly container: Phaser.GameObjects.Container;
  private shown = false;

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
    const w = Math.max(64, text.width + 24);
    const h = 26;
    const g = scene.add.graphics();
    g.fillStyle(0x3a76c4, 0.95).fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    g.lineStyle(2, 0xfdf6e3, 0.9).strokeRoundedRect(-w / 2, -h / 2, w, h, 8);

    this.container = scene.add
      .container(sx, sy, [g, text])
      .setDepth(80)
      .setVisible(false)
      .setAlpha(0);
    this.container.setSize(w, h);
    this.container.setInteractive(
      new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
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

  /** Show/hide with a pop as the player crosses the trigger distance. */
  setNear(near: boolean) {
    if (near === this.shown) return;
    this.shown = near;
    const c = this.container;
    const scene = c.scene;
    if (near) {
      c.setVisible(true).setScale(0.3).setAlpha(0);
      scene.tweens.add({
        targets: c,
        scale: 1,
        alpha: 1,
        duration: 200,
        ease: "Back.easeOut",
      });
    } else {
      scene.tweens.add({
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
