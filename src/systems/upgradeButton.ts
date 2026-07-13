import Phaser from "phaser";
import { M, RIM, floorY } from "../world";

// The beckoning "Upgrade" button (HOOP_PROGRESSION.md): once the shared
// score reaches the next tier's threshold it appears under the hoop —
// bobbing, pulsing, visibly calling a player over. ANY player can walk
// up and press it; the authority validates threshold + proximity.

/** The button's floor spot, court meters — directly at the bottom of the
 *  hoop. Pressing it is an errand: the character walks THROUGH the
 *  keep-out zone up to the hoop and touches it. */
export function upgradeButtonSpot() {
  return { x: RIM.x, d: RIM.d };
}

export class UpgradeButton {
  private readonly container: Phaser.GameObjects.Container;
  private readonly bob: Phaser.Tweens.Tween;
  private shown = false;

  constructor(scene: Phaser.Scene, onPress: () => void) {
    const spot = upgradeButtonSpot();
    const sx = spot.x * M;
    const sy = floorY(spot.d) - 40; // hovers at the bottom of the hoop

    const w = 116;
    const h = 34;
    const g = scene.add.graphics();
    g.fillStyle(0x2ea86a, 0.95).fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    g.lineStyle(2, 0xfdf6e3, 0.9).strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    const label = scene.add
      .text(0, 0, "⬆ UPGRADE", {
        fontFamily: "monospace",
        fontSize: "15px",
        fontStyle: "bold",
        color: "#fdf6e3",
      })
      .setOrigin(0.5);
    // the beckoning arrow under the panel, pointing at the floor spot
    const arrow = scene.add
      .text(0, h / 2 + 10, "▼", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#2ea86a",
      })
      .setOrigin(0.5);

    this.container = scene.add
      .container(sx, sy, [g, label, arrow])
      .setDepth(80)
      .setVisible(false)
      .setAlpha(0);
    this.container.setSize(w, h + 18);
    this.container.setInteractive(
      new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h + 18),
      Phaser.Geom.Rectangle.Contains,
    );
    (this.container.input as Phaser.Types.Input.InteractiveObject).cursor =
      "pointer";
    this.container.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) onPress();
    });

    // the "call a player over" life: a slow bob + a heartbeat pulse
    this.bob = scene.tweens.add({
      targets: this.container,
      y: sy - 8,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      paused: true,
    });
    scene.tweens.add({
      targets: label,
      scale: 1.12,
      duration: 460,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  /** Show when the threshold is met, hide otherwise — with a pop. */
  setAvailable(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    const c = this.container;
    const scene = c.scene;
    if (on) {
      c.setVisible(true).setScale(0.3).setAlpha(0);
      scene.tweens.add({
        targets: c,
        scale: 1,
        alpha: 1,
        duration: 260,
        ease: "Back.easeOut",
      });
      this.bob.resume();
    } else {
      this.bob.pause();
      scene.tweens.add({
        targets: c,
        scale: 0.3,
        alpha: 0,
        duration: 180,
        ease: "Cubic.easeIn",
        onComplete: () => c.setVisible(false),
      });
    }
  }
}
