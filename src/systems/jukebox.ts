import Phaser from "phaser";
import { MUSIC_MANIFEST, type AvailableAssets } from "../assets";
import { M, floorY, sortDepth } from "../world";
import { ProximityButton } from "./proximityButton";
import type { Player } from "../player";
import type { InteractiveElement } from "../shared/tierChanges";
import type { JukeboxState } from "../shared/messages";

// The Jukebox (Hoop 3's Interactive Element): a box left of the cheering
// area, off the court. Entering its trigger area pops ONE toggle button
// above it (owner 2026-07-16): ▶ starts a re-rolled random song that
// EVERYONE in the world hears ONCE - songs don't loop, they just end -
// and while a song plays the button reads ⏸ and stops it for everyone.
// Switching songs = off, then on again (each ▶ re-rolls, never the same
// song twice in a row). The authority owns the choice + start time;
// clients seek into the song so it ends for everyone around the same
// moment, and a joiner arriving after the end hears (and sees) nothing.
//
// While playing, the box pulses with the song's bass (a WebAudio analyser
// tap; fixed-tempo fallback) and sends little notes up into the air.
//
// Songs are asset SLOTS (assets/music/song1..3.ogg|mp3|wav). Missing
// files are fine: the press still syncs and announces, it just plays
// silence. Playback is a STREAMED HTMLAudioElement, not a Phaser sound:
// the real tracks are hour-long mixes, and WebAudio's decodeAudioData
// would inflate them to gigabytes of PCM (song3 flatly refused). The
// element starts playing within moments, seeks fine, and keeps playing
// on a blurred tab - which the spec wants anyway.

/** PLACEHOLDER (tune): owner 2026-07-16 - half of the previous 25%. */
const MUSIC_VOLUME = 0.125;
// Distance attenuation (owner bug 2026-07-16: "the volume seems to
// always be the same" - the box is a WORLD object, so standing beside
// it should be louder than hearing it from across the court). Full
// MUSIC_VOLUME within NEAR, easing down to FAR_FRAC of it at FAR and
// beyond - never to zero: the song is still "heard by everyone in the
// world" (HOOP_PROGRESSION.md). PLACEHOLDER (tune): all three.
const VOL_NEAR_M = 2.5;
const VOL_FAR_M = 16;
const VOL_FAR_FRAC = 0.25;
/** PLACEHOLDER (tune): note spawn cadence + pulse feel. */
const NOTE_EVERY_S = 0.7;
const PULSE_AMP = 0.06;
const FALLBACK_BPM = 100;

export class Jukebox {
  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly el: InteractiveElement;
  private readonly onPressed: () => void;
  private readonly onOffPressed: () => void;
  private readonly music: AvailableAssets["music"];

  private box: Phaser.GameObjects.Graphics | null = null;
  /** the play/pause toggle: ▶ starts a (re-rolled) song, ⏸ stops it */
  private button: ProximityButton | null = null;
  /** the streamed playback element (null = silent) */
  private audio: HTMLAudioElement | null = null;
  /** the analyser's media tap - kept to disconnect on stop */
  private mediaSrc: MediaElementAudioSourceNode | null = null;
  /** dedupe key: the authoritative start stamp of the adopted playback -
   *  NOT the song slot, so a re-pressed same slot restarts and a snapshot
   *  arriving after the natural end can't resurrect the song */
  private syncedStartMs: number | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private noteIn = 0;
  private t = 0;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    el: InteractiveElement,
    music: AvailableAssets["music"],
    onPressed: () => void,
    onOffPressed: () => void,
  ) {
    this.scene = scene;
    this.player = player;
    this.el = el;
    this.music = music;
    this.onPressed = onPressed;
    this.onOffPressed = onOffPressed;
  }

  spawn(animated: boolean) {
    if (this.box) return;
    this.box = this.drawBox();
    const bx = this.el.placement.xM * M;
    // owner 2026-07-16: 20 px higher than before
    const by = floorY(this.el.placement.dM - this.el.depthM / 2) - 66;
    // ONE toggle button (owner 2026-07-16): ▶ starts a song, and while
    // one plays it reads ⏸ and stops it for everyone - switching songs
    // is done by turning the jukebox off and on (each ▶ re-rolls).
    this.button = new ProximityButton(this.scene, bx, by, "▶", () =>
      this.isPlaying ? this.onOffPressed() : this.onPressed(),
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
    this.stopPlayback();
    this.syncedStartMs = null;
    this.box?.destroy();
    this.box = null;
    this.button?.destroy();
    this.button = null;
  }

  /** A song is audibly playing right now (drives the OFF toggle + vfx). */
  get isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused && !this.audio.ended;
  }

  update(dt: number) {
    if (!this.button) return;
    // press-in-passing: no occupancy, just the trigger area
    const near = this.edgeDistPx() <= this.el.proximityPx + 1;
    this.button.setNear(near);
    // the toggle face tracks the playback: ▶ to start, ⏸ to stop
    this.button.setLabel(this.isPlaying ? "⏸" : "▶");

    this.t += dt;
    if (this.audio) this.audio.volume = this.volumeAtPlayer();
    if (this.isPlaying) {
      // little notes drift up into the air (not on hidden tabs - no
      // stale bursts on return; the music itself keeps playing)
      this.noteIn -= dt;
      if (this.noteIn <= 0 && !document.hidden) {
        this.noteIn = NOTE_EVERY_S * (0.7 + Math.random() * 0.6);
        this.spawnNote();
      }
      // the speaker pulses with the bass - analyser when WebAudio offers
      // one, a steady FALLBACK_BPM thump otherwise
      let level: number;
      if (this.analyser && this.freqData) {
        this.analyser.getByteFrequencyData(this.freqData);
        let sum = 0;
        for (let i = 0; i < 4; i++) sum += this.freqData[i]; // lowest bins
        level = sum / (4 * 255);
      } else {
        level = Math.max(0, Math.sin(this.t * Math.PI * 2 * (FALLBACK_BPM / 60)));
      }
      this.box?.setScale(1 + PULSE_AMP * level);
    } else if (this.box && this.box.scale !== 1 && !this.scene.tweens.isTweening(this.box)) {
      this.box.setScale(1);
    }
  }

  /**
   * Adopt the authoritative playback (event, welcome, snapshot self-heal).
   * Seeks to the elapsed position so the song ends for everyone around
   * the same time; a joiner after the end gets silence and no animation.
   * PLACEHOLDER sync fidelity: clock skew and decode latency drift it.
   */
  sync(state: JukeboxState | null | undefined) {
    if (!state) {
      this.stopPlayback();
      this.syncedStartMs = null;
      return;
    }
    if (this.syncedStartMs === state.startedAtMs) return; // already adopted
    this.stopPlayback();
    this.syncedStartMs = state.startedAtMs;
    const key = MUSIC_MANIFEST[state.song];
    const entry = key ? this.music.find((m) => m.key === key) : undefined;
    if (!entry) return; // silent slot
    const audio = new Audio(entry.url);
    audio.preload = "auto";
    audio.volume = this.volumeAtPlayer(); // update() keeps tracking distance
    audio.loop = false; // songs don't loop - they just end
    this.audio = audio;
    // duration is only known once the metadata streams in; seek then
    audio.addEventListener("loadedmetadata", () => {
      if (this.audio !== audio) return; // superseded meanwhile
      const seekS = (Date.now() - state.startedAtMs) / 1000;
      if (Number.isFinite(audio.duration) && seekS >= audio.duration) {
        this.stopPlayback(); // the song already ended out there
        return;
      }
      audio.currentTime = Math.max(0, seekS);
      audio.play().then(
        () => this.tapAnalyser(audio),
        // autoplay policy: no user gesture yet (e.g. a rejoin adopting a
        // running song) - retry the same state on the first input
        () => this.retryOnGesture(state),
      );
    });
    audio.addEventListener("ended", () => {
      if (this.audio === audio) this.stopPlayback();
    });
  }

  /** Re-adopt `state` on the first pointer/key input (autoplay unlock). */
  private retryOnGesture(state: JukeboxState) {
    const retry = () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      if (this.syncedStartMs !== state.startedAtMs) return; // moved on
      this.syncedStartMs = null; // force the re-adopt
      this.sync(state);
    };
    window.addEventListener("pointerdown", retry, { once: true });
    window.addEventListener("keydown", retry, { once: true });
  }

  /** The song slot's display name for the wall line. */
  songLabel(song: number): string {
    const key = MUSIC_MANIFEST[song] ?? `song${song + 1}`;
    const has = this.music.some((m) => m.key === key);
    return has ? key : `${key} (no file - silence)`;
  }

  private stopPlayback() {
    this.audio?.pause();
    if (this.audio) this.audio.src = ""; // release the stream
    this.audio = null;
    this.mediaSrc?.disconnect();
    this.mediaSrc = null;
    this.analyser = null;
    this.freqData = null;
    this.box?.setScale(1);
  }

  /**
   * Tap the streamed element into an analyser for the bass pulse. The
   * tap REROUTES the element's output through the context, so only do it
   * on a RUNNING context (a suspended one would silence the song - the
   * fixed-tempo fallback pulse covers that case instead).
   */
  private tapAnalyser(audio: HTMLAudioElement) {
    this.analyser = null;
    this.freqData = null;
    const sm = this.scene.sound;
    if (
      !(sm instanceof Phaser.Sound.WebAudioSoundManager) ||
      sm.context.state !== "running"
    )
      return;
    try {
      const ctx = sm.context;
      const src = ctx.createMediaElementSource(audio);
      const an = ctx.createAnalyser();
      an.fftSize = 64;
      src.connect(an);
      src.connect(ctx.destination); // the tap replaces the direct path
      this.mediaSrc = src;
      this.analyser = an;
      this.freqData = new Uint8Array(an.frequencyBinCount);
    } catch {
      this.analyser = null; // fixed-tempo fallback takes over
    }
  }

  /** One little ♪ drifting up from the box into the air. */
  private spawnNote() {
    const cx = this.el.placement.xM * M;
    const yTop = floorY(this.el.placement.dM + this.el.depthM / 2) - 50;
    const n = this.scene.add
      .text(
        cx + (Math.random() * 24 - 12),
        yTop,
        Math.random() < 0.5 ? "♪" : "♫",
        // owner 2026-07-16: black notes, not yellow
        { fontFamily: "monospace", fontSize: "16px", color: "#111111" },
      )
      .setOrigin(0.5)
      .setDepth(sortDepth(this.el.placement.dM) - 1)
      .setAlpha(0.95);
    this.scene.tweens.add({
      targets: n,
      y: yTop - 44 - Math.random() * 20,
      x: n.x + (Math.random() * 24 - 12),
      alpha: 0,
      duration: 1300,
      ease: "Sine.easeOut",
      onComplete: () => n.destroy(),
    });
  }

  /** MUSIC_VOLUME shaped by how far the player stands from the box. */
  private volumeAtPlayer(): number {
    const { xM, dM } = this.el.placement;
    const dist = Math.hypot(this.player.x - xM, this.player.d - dM);
    const f = Math.min(
      1,
      Math.max(0, (dist - VOL_NEAR_M) / (VOL_FAR_M - VOL_NEAR_M)),
    );
    return MUSIC_VOLUME * (1 - f * (1 - VOL_FAR_FRAC));
  }

  private edgeDistPx(): number {
    const { xM, dM } = this.el.placement;
    const dx = Math.max(0, Math.abs(this.player.x - xM) - this.el.widthM / 2);
    const dd = Math.max(0, Math.abs(this.player.d - dM) - this.el.depthM / 2);
    return Math.hypot(dx, dd) * M;
  }

  /** A chunky little jukebox: arched body, grill, glowing window.
   *  Drawn in LOCAL coords around its bottom-center so the bass pulse
   *  (setScale) breathes from the base, not the scene origin. */
  private drawBox(): Phaser.GameObjects.Graphics {
    const cx = this.el.placement.xM * M;
    const yBot = floorY(this.el.placement.dM + this.el.depthM / 2);
    const w = this.el.widthM * M;
    const h = 46;
    const x0 = -w / 2;
    const g = this.scene.add
      .graphics()
      .setPosition(cx, yBot)
      .setDepth(sortDepth(this.el.placement.dM) - 2);

    // body with an arched top
    g.fillStyle(0x8a3050).fillRoundedRect(x0, -h, w, h, {
      tl: 14,
      tr: 14,
      bl: 2,
      br: 2,
    });
    g.lineStyle(2, 0x5c1e34).strokeRoundedRect(x0, -h, w, h, {
      tl: 14,
      tr: 14,
      bl: 2,
      br: 2,
    });
    // glowing window
    g.fillStyle(0xffd97a, 0.9).fillRoundedRect(x0 + 6, -h + 6, w - 12, 12, 5);
    // speaker grill
    g.fillStyle(0x5c1e34);
    for (let i = 0; i < 3; i++) g.fillRect(x0 + 7, -20 + i * 5, w - 14, 2);
    return g;
  }
}
