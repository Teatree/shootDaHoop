import Phaser from "phaser";
import { T } from "../tuning";
import { M, RIM, floorDistToRim } from "../world";
import { SunSystem, shadowShift } from "../sky";
import { SpeechBubbles } from "../speech";
import type { HUD } from "../hud";
import { esc } from "../hud";
import {
  createHoop,
  createKeepOutZone,
  drawBackdrop,
  drawCourt,
  drawWall,
  ensurePlaceholderTextures,
  type HoopParts,
} from "../placeholders";
import { Player } from "../player";
import { CameraRig } from "../cameraRig";
import { AimController, type Shot } from "../aiming";
import { Ball, type ShotOutcome } from "../ball";
import { pointsForDistance } from "../scoring";
import { playSfx } from "../sfx";
import type { AvailableAssets } from "../assets";
import type { ThrowRecording } from "../ghostData";
import { TeleportSystem } from "../systems/teleport";
import { RecordingSystem } from "../systems/recording";
import {
  presentMiss,
  presentScore,
  replayMadeEffect,
} from "../systems/shotFeedback";

// The court itself: builds the world, wires the systems together, and owns
// the frame order. Feature logic lives in the systems —
//   systems/teleport.ts     the orb power-up + levitation state machine
//   systems/recording.ts    ghost record capture + playback
//   systems/shotFeedback.ts score/miss juice + the court-wall log lines
// and the ball's physics is the pure stepper in physics.ts.
export class CourtScene extends Phaser.Scene {
  private player!: Player;
  private rig!: CameraRig;
  private aim!: AimController;
  private hoop!: HoopParts;
  private sky!: SunSystem;
  private speech!: SpeechBubbles;
  private keepOutZone!: Phaser.GameObjects.Graphics;
  private teleport!: TeleportSystem;
  private recording!: RecordingSystem;
  private balls: Ball[] = [];
  private score = 0;

  constructor(
    private readonly hud: HUD,
    private readonly assets: AvailableAssets,
    private readonly playerName: string,
  ) {
    super("court");
  }

  preload() {
    // only assets that were probed to exist — everything else is a placeholder
    for (const key of this.assets.images)
      this.load.image(key, `assets/${key}.png`);
    for (const key of this.assets.audio)
      this.load.audio(key, [`assets/${key}.wav`]);
  }

  create() {
    ensurePlaceholderTextures(this);
    drawBackdrop(this);
    drawCourt(this);
    drawWall(this);
    this.keepOutZone = createKeepOutZone(this);
    this.hoop = createHoop(this);
    this.sky = new SunSystem(this);
    this.player = new Player(this, this.playerName);
    this.speech = new SpeechBubbles(this, this.player);
    this.aim = new AimController(
      this,
      this.player,
      (shot) => this.throwBall(shot),
      (sx, sy) => this.clickRipple(sx, sy),
    );
    this.teleport = new TeleportSystem(this, this.player, {
      aim: this.aim,
      throwWeak: () =>
        this.throwBall({ vx: 0, vh: T.tp.weakThrowVh, power: 0 }, true),
      onTeleport: (from, to) => this.recording.noteTeleport(from, to),
    });
    this.recording = new RecordingSystem(
      this,
      { player: this.player, orb: this.teleport.orb, speech: this.speech },
      () => replayMadeEffect(this, this.hoop),
    );
    this.rig = new CameraRig(this, this.player);

    // dev console handle for poking at feel state while tuning
    (window as unknown as Record<string, unknown>).__court = this;

    this.hud.log("presence", `${esc(this.playerName)} joined the court.`);
    this.hud.onChat((msg) => {
      this.hud.log(
        "chat",
        `<span class="who">${esc(this.playerName)}:</span> ${esc(msg)}`,
      );
      this.speech.say(msg);
      playSfx(this, "sfx_chat", 0.5);
    });
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.05);
    this.sky.update(dt);
    const light = this.sky.lightDir();
    this.player.update(dt, light);
    this.speech.update(dt);
    this.aim.update();
    for (const b of this.balls) b.update(dt, light);
    this.teleport.update(dt, this.balls);
    this.recording.update(dt);

    this.balls = this.balls.filter((b) => !b.done);
    this.rig.update(dt);

    // keep-out zone fades in only when the player is pressed up close
    const zoneX = (RIM.x - T.move.hoopStandoffM) * M;
    const near = zoneX - this.player.x * M <= T.move.zoneShowDistPx;
    const kz = 1 - Math.exp(-T.move.zoneFadeLerp * dt);
    this.keepOutZone.alpha += ((near ? 1 : 0) - this.keepOutZone.alpha) * kz;

    // hoop drop shadow tracks the sun (caster ≈ mid-rim height)
    this.hoop.shadow.x =
      RIM.x * M + 8 + shadowShift(T.hoop.rimHeightM * 0.5, light);
    this.hoop.shadow.scaleX =
      1 + (T.sky.shadowStretchMax - 1) * (1 - light.elev);
    this.hoop.shadow.fillAlpha = Phaser.Math.Linear(
      T.sky.shadowAlphaLow,
      T.sky.shadowAlphaHigh,
      light.elev,
    );
  }

  // ── shooting ───────────────────────────────────────────────────────

  private throwBall(shot: Shot, slam = false) {
    const rp = this.player.releasePoint();
    const distM = floorDistToRim(this.player.x, this.player.d);
    const isSlam = slam || this.teleport.isLevitating;

    // the recorder is created right after the ball; callbacks fire only
    // from later update ticks, so `rec` is always assigned by then
    let rec!: ThrowRecording;
    const ball = new Ball(this, {
      x: rp.x,
      d: rp.d,
      h: rp.h,
      vx: shot.vx,
      vh: shot.vh,
      shotDistM: distM,
      onScore: (o) => {
        this.recording.stampOutcome(rec, true);
        this.onScore(o, isSlam, rec);
      },
      onMiss: (o) => {
        this.recording.stampOutcome(rec, false);
        this.onMiss(o, isSlam, rec);
      },
      onDone: () => {
        /* filtered out in update() via .done */
      },
    });
    rec = this.recording.beginThrow(ball, isSlam, this.playerName);
    this.balls.push(ball);

    // the levitation throw is the last act up there — falling starts now
    this.teleport.onThrowReleased();
  }

  private onScore(o: ShotOutcome, slam: boolean, rec: ThrowRecording) {
    const pts = slam ? T.tp.slamPts : pointsForDistance(o.distM);
    this.score += pts;
    this.hud.setScore(this.score);
    presentScore(
      { scene: this, hud: this.hud, hoop: this.hoop, who: this.playerName },
      o,
      pts,
      slam,
      () => this.recording.play(rec),
    );
  }

  private onMiss(o: ShotOutcome, slam: boolean, rec: ThrowRecording) {
    presentMiss(
      { scene: this, hud: this.hud, hoop: this.hoop, who: this.playerName },
      o,
      slam,
      () => this.recording.play(rec),
    );
  }

  // ── small move-order feedback ──────────────────────────────────────

  private clickRipple(sx: number, sy: number) {
    const c = this.add.circle(sx, sy, 6, 0xfff3d6, 0).setDepth(50);
    c.setStrokeStyle(2, 0xfff3d6, 0.8);
    this.tweens.add({
      targets: c,
      scale: 2.2,
      alpha: 0,
      duration: 320,
      ease: "Cubic.easeOut",
      onComplete: () => c.destroy(),
    });
  }
}
