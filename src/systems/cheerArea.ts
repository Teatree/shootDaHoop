import Phaser from "phaser";
import { T } from "../tuning";
import { M, floorY, sortDepth } from "../world";
import { ProximityButton } from "./proximityButton";
import type { Player } from "../player";
import type { InteractiveElement } from "../shared/tierChanges";
import { interactiveSpots } from "../shared/tierRules";

// The Cheering Area (Hoop 2's Interactive Element): a small wooden deck
// above the spawn area, outside the court, that ~3 characters can stand
// in. Walk very close → a "Cheer" button pops up → pressing it walks the
// character UP INTO the deck - already cheering on the way (the doc's
// beat) - and they stand there pumping until other input pulls them out:
// a walk/throw click first walks the character back DOWN out of the
// area, then obeys (leaveThen).
//
// Occupancy is cosmetic: each client picks a free-looking spot from the
// remote avatars it can see. PLACEHOLDER: no authority arbitrates spots -
// two players entering at once can share one. Fine for ~3-crowd decks.

type Phase = "idle" | "entering" | "occupying" | "leaving";

export class CheerArea {
  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly el: InteractiveElement;
  /** where remote avatars stand, for the cosmetic spot pick */
  private readonly remotePositions: () => { x: number; d: number }[];

  private deck: Phaser.GameObjects.Graphics | null = null;
  private button: ProximityButton | null = null;
  private phase: Phase = "idle";
  private target = { x: 0, d: 0 };
  private afterLeave: (() => void) | null = null;
  /** cheering crowds look around: seconds until the next facing flip */
  private flipIn = 0;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    el: InteractiveElement,
    remotePositions: () => { x: number; d: number }[],
  ) {
    this.scene = scene;
    this.player = player;
    this.el = el;
    this.remotePositions = remotePositions;
  }

  /** Build the deck (upgrade choreography: quickly pops into existence). */
  spawn(animated: boolean) {
    if (this.deck) return;
    this.deck = this.drawDeck();
    this.button = new ProximityButton(
      this.scene,
      this.el.placement.xM * M,
      floorY(this.el.placement.dM - this.el.depthM / 2) - 86, // above the bench (owner: down 40 px, 2026-07-14)
      "🙌 CHEER",
      () => this.enter(),
    );
    if (animated) {
      // "the area quickly pops into existence"
      const g = this.deck;
      g.setScale(0.2).setAlpha(0);
      this.scene.tweens.add({
        targets: g,
        scale: 1,
        alpha: 1,
        duration: 240,
        ease: "Back.easeOut",
      });
    }
  }

  destroy() {
    this.exitInstantly();
    this.deck?.destroy();
    this.deck = null;
    this.button?.destroy();
    this.button = null;
  }

  /** True while the character is in (or moving through) the area. */
  get active(): boolean {
    return this.phase !== "idle";
  }

  /**
   * Input yielding: if the character is up in the area, walk back down
   * out of it FIRST, then run the input's action. Returns true when the
   * input was intercepted.
   */
  leaveThen(after: () => void): boolean {
    if (this.phase === "idle") return false;
    this.afterLeave = after;
    this.beginLeave();
    return true;
  }

  update(_dt: number) {
    if (!this.deck) return;

    // the trigger: within proximityPx (edge-to-edge, world px) of the deck
    if (this.button) {
      const near =
        this.phase === "idle" &&
        this.player.control === "full" &&
        this.edgeDistPx() <= this.el.proximityPx + 1;
      this.button.setNear(near);
    }

    // standing and cheering: every so often the character turns to face
    // the other way, like a crowd looking around (facing streams in the
    // telemetry, so everyone sees the flips)
    if (this.phase === "occupying") {
      this.flipIn -= _dt;
      if (this.flipIn <= 0) {
        this.player.flipFacing();
        this.flipIn = this.rollFlipIn();
      }
    }

    // scripted walk in/out (the player's own walkTo clamps to the court,
    // so the deck errand drives the position directly)
    if (this.phase === "entering" || this.phase === "leaving") {
      const dx = this.target.x - this.player.x;
      const dd = this.target.d - this.player.d;
      const dist = Math.hypot(dx, dd);
      const step = T.move.speedM * _dt;
      if (dist <= Math.max(T.move.arriveEps, step)) {
        this.player.x = this.target.x;
        this.player.d = this.target.d;
        if (this.phase === "entering") {
          this.phase = "occupying";
        } else {
          this.exitInstantly();
          const after = this.afterLeave;
          this.afterLeave = null;
          after?.();
        }
      } else {
        this.player.x += (dx / dist) * step;
        this.player.d += (dd / dist) * step;
      }
    }
  }

  /** The Cheer press: walk up into the deck, already cheering. */
  private enter() {
    if (this.phase !== "idle" || this.player.control !== "full") return;
    this.phase = "entering";
    this.target = this.pickSpot();
    this.player.stop();
    this.player.control = "none"; // walk/aim input routes via leaveThen
    // the cheer is ALREADY playing while the character walks up
    this.player.poseOverride = "cheer";
    this.flipIn = this.rollFlipIn();
  }

  /** PLACEHOLDER (tune): a flip every 10–40 s, re-rolled each time. */
  private rollFlipIn(): number {
    return 10 + Math.random() * 30;
  }

  private beginLeave() {
    if (this.phase === "leaving") return;
    this.phase = "leaving";
    // back down to the court, just below where they stand
    this.target = { x: this.player.x, d: 0.6 };
  }

  private exitInstantly() {
    if (this.phase === "idle") return;
    this.phase = "idle";
    this.player.poseOverride = null;
    this.player.control = "full";
  }

  /** Cosmetic spot pick: the first of the ~3 spots no one seems to hold. */
  private pickSpot(): { x: number; d: number } {
    const spots = this.spots();
    const others = this.remotePositions();
    const free = spots.find(
      (s) => !others.some((o) => Math.hypot(o.x - s.x, o.d - s.d) < 0.5),
    );
    return free ?? spots[Math.floor(Math.random() * spots.length)];
  }

  private spots(): { x: number; d: number }[] {
    // the ONE spot formula, shared with the server's offline seating
    return interactiveSpots(this.el);
  }

  /**
   * Distance (world px) from the player to the deck rect, PER AXIS -
   * "within N px each way from the edges": the trigger area is the
   * bench's rectangle grown by proximityPx on every side.
   */
  private edgeDistPx(): number {
    const { xM, dM } = this.el.placement;
    const dx = Math.max(0, Math.abs(this.player.x - xM) - this.el.widthM / 2);
    const dd = Math.max(0, Math.abs(this.player.d - dM) - this.el.depthM / 2);
    return Math.max(dx, dd) * M;
  }

  /** A small raised wooden platform: plank top + front skirt + legs. */
  private drawDeck(): Phaser.GameObjects.Graphics {
    const { xM, dM } = this.el.placement;
    const x0 = (xM - this.el.widthM / 2) * M;
    const x1 = (xM + this.el.widthM / 2) * M;
    const yTop = floorY(dM - this.el.depthM / 2);
    const yBot = floorY(dM + this.el.depthM / 2);
    const g = this.scene.add.graphics().setDepth(sortDepth(dM) - 2);

    // plank top (alternating half-meter stripes of warm wood)
    const stripe = M / 2;
    for (let x = x0, i = 0; x < x1; x += stripe, i++) {
      g.fillStyle(i % 2 === 0 ? 0xb98a5e : 0xa87a50);
      g.fillRect(x, yTop, Math.min(stripe, x1 - x), yBot - yTop);
    }
    g.lineStyle(2, 0x7a5a3a, 0.9).strokeRect(x0, yTop, x1 - x0, yBot - yTop);
    // front skirt + stubby legs so it reads raised over the sand
    g.fillStyle(0x8a6a46).fillRect(x0, yBot, x1 - x0, 7);
    g.fillStyle(0x6a4e32);
    g.fillRect(x0 + 3, yBot + 7, 5, 5);
    g.fillRect(x1 - 8, yBot + 7, 5, 5);
    return g;
  }
}
