import Phaser from "phaser";
import { MUSIC_MANIFEST, type AvailableAssets } from "../assets";
import { M, floorY, sortDepth } from "../world";
import { ProximityButton } from "./proximityButton";
import type { Player } from "../player";
import type { InteractiveElement } from "../shared/tierChanges";
import type { JukeboxState } from "../shared/messages";

// The Jukebox (Hoop 3's Interactive Element): a box left of the cheering
// area, off the court. Very close → a button pops above it; pressing
// re-rolls a random song that EVERYONE in the world hears on a loop —
// the authority owns the choice + start time, clients seek into the
// loop so late joiners land mid-song.
//
// Songs are asset SLOTS (assets/music/song1..3.mp3|wav). Missing files
// are fine: the press still syncs and announces, it just plays silence.

export class Jukebox {
  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly el: InteractiveElement;
  private readonly onPressed: () => void;
  private readonly music: AvailableAssets["music"];

  private box: Phaser.GameObjects.Graphics | null = null;
  private button: ProximityButton | null = null;
  private sound: Phaser.Sound.BaseSound | null = null;
  private playingSong: number | null = null;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    el: InteractiveElement,
    music: AvailableAssets["music"],
    onPressed: () => void,
  ) {
    this.scene = scene;
    this.player = player;
    this.el = el;
    this.music = music;
    this.onPressed = onPressed;
  }

  spawn(animated: boolean) {
    if (this.box) return;
    this.box = this.drawBox();
    this.button = new ProximityButton(
      this.scene,
      this.el.placement.xM * M,
      floorY(this.el.placement.dM - this.el.depthM / 2) - 46,
      "♪ JUKEBOX",
      () => this.onPressed(),
    );
    if (animated) {
      const g = this.box;
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
    this.stop();
    this.box?.destroy();
    this.box = null;
    this.button?.destroy();
    this.button = null;
  }

  update(_dt: number) {
    if (!this.button) return;
    // press-in-passing: no occupancy, just the very-close trigger
    this.button.setNear(this.edgeDistPx() <= this.el.proximityPx + 1);
  }

  /**
   * Adopt the authoritative loop (event, welcome, snapshot self-heal).
   * Seeks into the song so every client hears roughly the same beat —
   * PLACEHOLDER sync fidelity: clock skew and decode latency drift it.
   */
  sync(state: JukeboxState | null | undefined) {
    if (!state) {
      this.stop();
      return;
    }
    if (this.playingSong === state.song) return; // already on this loop
    this.stop();
    this.playingSong = state.song;
    const key = MUSIC_MANIFEST[state.song];
    const has = key && this.music.some((m) => m.key === key);
    if (!has || !this.scene.cache.audio.exists(key)) return; // silent slot
    const sound = this.scene.sound.add(key, { loop: true, volume: 0.6 });
    const durS = sound.duration || 0;
    const seek = durS > 0 ? ((Date.now() - state.startedAtMs) / 1000) % durS : 0;
    sound.play({ seek: Math.max(0, seek) });
    this.sound = sound;
  }

  /** The song slot's display name for the wall line. */
  songLabel(song: number): string {
    const key = MUSIC_MANIFEST[song] ?? `song${song + 1}`;
    const has = this.music.some((m) => m.key === key);
    return has ? key : `${key} (no file — silence)`;
  }

  private stop() {
    this.sound?.destroy();
    this.sound = null;
    this.playingSong = null;
  }

  private edgeDistPx(): number {
    const { xM, dM } = this.el.placement;
    const dx = Math.max(0, Math.abs(this.player.x - xM) - this.el.widthM / 2);
    const dd = Math.max(0, Math.abs(this.player.d - dM) - this.el.depthM / 2);
    return Math.hypot(dx, dd) * M;
  }

  /** A chunky little jukebox: arched body, grill, glowing window. */
  private drawBox(): Phaser.GameObjects.Graphics {
    const cx = this.el.placement.xM * M;
    const yBot = floorY(this.el.placement.dM + this.el.depthM / 2);
    const w = this.el.widthM * M;
    const h = 46;
    const x0 = cx - w / 2;
    const g = this.scene.add.graphics().setDepth(sortDepth(this.el.placement.dM) - 2);

    // body with an arched top
    g.fillStyle(0x8a3050).fillRoundedRect(x0, yBot - h, w, h, {
      tl: 14,
      tr: 14,
      bl: 2,
      br: 2,
    });
    g.lineStyle(2, 0x5c1e34).strokeRoundedRect(x0, yBot - h, w, h, {
      tl: 14,
      tr: 14,
      bl: 2,
      br: 2,
    });
    // glowing window
    g.fillStyle(0xffd97a, 0.9).fillRoundedRect(x0 + 6, yBot - h + 6, w - 12, 12, 5);
    // speaker grill
    g.fillStyle(0x5c1e34);
    for (let i = 0; i < 3; i++)
      g.fillRect(x0 + 7, yBot - 20 + i * 5, w - 14, 2);
    return g;
  }
}
