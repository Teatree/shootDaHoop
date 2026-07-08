import Phaser from "phaser";
import { T } from "../tuning";
import { M, RIM, floorDistToRim, screenToFloor } from "../world";
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
import { Ball } from "../ball";
import { playSfx } from "../sfx";
import type { AvailableAssets } from "../assets";
import type { ThrowRecording } from "../ghostData";
import type { ThrowLaunch, ThrowOutcome } from "../shared/messages";
import type { Backend } from "../backend/types";
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
// the ball's physics is the pure stepper in shared/physics.ts, and ALL
// gameplay intents/outcomes flow through the Backend seam — the scene
// never touches a transport (LocalBackend today, SocketBackend later).
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
  private selfId = "";
  private throwSeq = 0;
  private recsByThrowId = new Map<string, ThrowRecording>();

  constructor(
    private readonly hud: HUD,
    private readonly assets: AvailableAssets,
    private readonly playerName: string,
    private readonly backend: Backend,
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
      (shot) => this.sendThrow(shot, false),
      (sx, sy) => this.walkClick(sx, sy),
    );
    this.teleport = new TeleportSystem(this, this.player, {
      aim: this.aim,
      throwWeak: () =>
        this.sendThrow({ vx: 0, vh: T.tp.weakThrowVh, power: 0 }, true),
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

    // ── backend wiring: intents out, events in ─────────────────────
    this.backend.on("welcome", (e) => {
      this.selfId = e.selfId;
      this.hud.log("presence", `${esc(this.playerName)} joined the court.`);
      this.hud.setScore(e.world.sharedScore);
    });
    this.backend.on("throwStarted", (e) => {
      if (e.id === this.selfId) this.spawnBall(e.throwId, e.launch);
      // remote players' throws spawn their own balls in Stage 2
    });
    this.backend.on("outcome", (e) => this.presentOutcome(e));
    this.backend.on("chatMessage", (e) => {
      this.hud.log(
        "chat",
        `<span class="who">${esc(e.name)}:</span> ${esc(e.text)}`,
      );
      if (e.id === this.selfId) this.speech.say(e.text);
      playSfx(this, "sfx_chat", 0.5);
    });

    this.hud.onChat((msg) => this.backend.chat(msg));
    this.backend.connect();
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
    const near = zoneX - this.player.x * M <= T.zone.showDistPx;
    const kz = 1 - Math.exp(-T.zone.fadeLerp * dt);
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

  // ── shooting: intent → backend → throwStarted → live ball ─────────

  /** Package the aim result as a launch intent and send it upstream. */
  private sendThrow(shot: Shot, slam: boolean) {
    const rp = this.player.releasePoint();
    const launch: ThrowLaunch = {
      shotX: this.player.x,
      shotD: this.player.d,
      x: rp.x,
      d: rp.d,
      h: rp.h,
      vx: shot.vx,
      vh: shot.vh,
      slam: slam || this.teleport.isLevitating,
    };
    const throwId = `t${++this.throwSeq}`;
    this.backend.requestThrow(throwId, launch);
    // the levitation throw is the last act up there — falling starts now
    this.teleport.onThrowReleased();
  }

  /** A confirmed throw: spawn the live feel-simulation ball + recorder. */
  private spawnBall(throwId: string, launch: ThrowLaunch) {
    // the recorder is created right after the ball; callbacks fire only
    // from later update ticks, so `rec` is always assigned by then
    let rec!: ThrowRecording;
    const ball = new Ball(this, {
      x: launch.x,
      d: launch.d,
      h: launch.h,
      vx: launch.vx,
      vh: launch.vh,
      shotDistM: floorDistToRim(launch.shotX, launch.shotD),
      onScore: (o) => {
        this.recording.stampOutcome(rec, true);
        this.backend.reportOutcome(throwId, {
          made: true,
          swish: o.swish,
          slam: launch.slam,
          distM: o.distM,
        });
      },
      onMiss: (o) => {
        this.recording.stampOutcome(rec, false);
        this.backend.reportOutcome(throwId, {
          made: false,
          swish: false,
          slam: launch.slam,
          distM: o.distM,
        });
      },
      onDone: () => {
        /* filtered out in update() via .done */
      },
    });
    rec = this.recording.beginThrow(ball, launch.slam, this.playerName);
    this.recsByThrowId.set(throwId, rec);
    this.balls.push(ball);
  }

  /** The authoritative result came back — score display + juice + log. */
  private presentOutcome(e: ThrowOutcome) {
    this.hud.setScore(e.world.sharedScore);
    const rec = this.recsByThrowId.get(e.throwId);
    this.recsByThrowId.delete(e.throwId);
    const onReplay = rec ? () => this.recording.play(rec) : undefined;
    const ctx = {
      scene: this,
      hud: this.hud,
      hoop: this.hoop,
      who: this.playerName,
    };
    const o = { made: e.made, swish: e.swish, distM: e.distM };
    if (e.made) presentScore(ctx, o, e.points, e.slam, onReplay);
    else presentMiss(ctx, o, e.slam, onReplay);
  }

  // ── movement: animate immediately, broadcast the intent ───────────

  private walkClick(sx: number, sy: number) {
    const { x, d } = screenToFloor(sx, sy);
    this.backend.moveTo(x, d);
    this.clickRipple(sx, sy);
  }

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
