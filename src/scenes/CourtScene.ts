import Phaser from "phaser";
import { T } from "../tuning";
import { M, RIM, floorDistToRim, toScreen } from "../world";
import { SunSystem, shadowShift } from "../sky";
import { SpeechBubbles } from "../speech";
import { TeleportOrb } from "../powerup";
import {
  GhostPlayback,
  type PlayerSample,
  type ThrowRecording,
} from "../ghost";
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
import { burst, flash, floatText, netSnap } from "../juice";
import { playSfx } from "../sfx";
import type { AvailableAssets } from "../assets";

export class CourtScene extends Phaser.Scene {
  private player!: Player;
  private rig!: CameraRig;
  private aim!: AimController;
  private hoop!: HoopParts;
  private sky!: SunSystem;
  private speech!: SpeechBubbles;
  private keepOutZone!: Phaser.GameObjects.Graphics;
  private balls: Ball[] = [];
  private score = 0;

  // teleport power-up state machine
  private orb!: TeleportOrb;
  private tpState: "none" | "levitate" | "fall" | "down" = "none";
  private tpTimer = 0;
  private tpReturnD = 0; //   depth row to fall back onto
  private tpFallV = 0;

  // ghost records: rolling player history + one recorder per live throw
  private ghost!: GhostPlayback;
  private timeS = 0;
  private playerHistory: PlayerSample[] = [];
  private activeRecs: { rec: ThrowRecording; ball: Ball; t0: number }[] = [];
  private recStore: ThrowRecording[] = [];

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
    this.orb = new TeleportOrb(this);
    this.ghost = new GhostPlayback(this, () => {
      // the recorded shot drops again — snap the real net, small flash
      netSnap(this, this.hoop.net);
      flash(this, this.hoop.rimSX, this.hoop.rimSY, 18);
    });
    this.rig = new CameraRig(this, this.player);
    this.aim = new AimController(
      this,
      this.player,
      (shot) => this.throwBall(shot),
      (sx, sy) => this.clickRipple(sx, sy),
    );

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

    // teleport orb: spawn/pulse/expire, and did any ball hit it?
    this.orb.update(dt);
    if (this.tpState === "none") {
      for (const b of this.balls) {
        if (b.done) continue;
        const p = b.pos;
        const hit = this.orb.tryHit(p.x, p.d, p.h);
        if (hit) {
          this.teleportTo(hit, b);
          break;
        }
      }
    }
    this.updateTeleportState(dt);
    this.recordFrame(dt);

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

  // ── ghost records ──────────────────────────────────────────────────

  /** Sample this frame into the rolling history and every live recorder. */
  private recordFrame(dt: number) {
    this.timeS += dt;
    const vs = this.player.visualState();
    this.playerHistory.push({ t: this.timeS, ...vs });
    const keepFrom = this.timeS - T.ghost.preRollS - 0.5;
    while (this.playerHistory.length && this.playerHistory[0].t < keepFrom)
      this.playerHistory.shift();

    for (let i = this.activeRecs.length - 1; i >= 0; i--) {
      const ar = this.activeRecs[i];
      const rt = this.timeS - ar.t0;
      ar.rec.playerSamples.push({ t: rt, ...vs });
      if (!ar.ball.done) {
        const p = ar.ball.pos;
        ar.rec.ballSamples.push({ t: rt, x: p.x, d: p.d, h: p.h });
      }
      if (
        ar.rec.outcomeT !== undefined &&
        rt >= ar.rec.outcomeT + T.ghost.postRollS
      ) {
        ar.rec.done = true;
        ar.rec.duration = ar.rec.outcomeT + T.ghost.postRollS;
        this.activeRecs.splice(i, 1);
      } else if (ar.ball.done && ar.rec.outcomeT === undefined) {
        // ball was consumed (power-up) — no log line, nothing to replay
        this.activeRecs.splice(i, 1);
      }
    }

    this.ghost.update(dt);
  }

  // ── shooting ───────────────────────────────────────────────────────

  private throwBall(shot: Shot, slam = false) {
    const rp = this.player.releasePoint();
    const distM = floorDistToRim(this.player.x, this.player.d);
    const isSlam = slam || this.tpState === "levitate";

    // ghost record: pre-roll comes from the rolling history
    const t0 = this.timeS - T.ghost.preRollS;
    const rec: ThrowRecording = {
      name: this.playerName,
      playerSamples: this.playerHistory
        .filter((s) => s.t >= t0)
        .map((s) => ({ ...s, t: s.t - t0 })),
      ballSamples: [],
      done: false,
      evicted: false,
    };
    this.recStore.push(rec);
    if (this.recStore.length > T.ghost.maxStored) {
      const old = this.recStore.shift()!;
      old.evicted = true; // free the memory; its log line goes inert
      old.playerSamples = [];
      old.ballSamples = [];
    }

    const ball = new Ball(this, {
      x: rp.x,
      d: rp.d,
      h: rp.h,
      vx: shot.vx,
      vh: shot.vh,
      shotDistM: distM,
      onScore: (o) => {
        rec.outcomeT = this.timeS - t0;
        rec.made = true;
        this.onScore(o, isSlam, rec);
      },
      onMiss: (o) => {
        rec.outcomeT = this.timeS - t0;
        rec.made = false;
        this.onMiss(o, isSlam, rec);
      },
      onDone: () => {
        /* filtered out in update() via .done */
      },
    });
    this.balls.push(ball);
    this.activeRecs.push({ rec, ball, t0 });

    // the levitation throw is the last act up there — falling starts now
    if (this.tpState === "levitate") this.startFall();
  }

  // ── teleport power-up ──────────────────────────────────────────────

  private teleportTo(dest: { x: number; d: number; h: number }, ball: Ball) {
    ball.consume();
    const ZAP = [0x2e7bff, 0x9fd0ff, 0xffffff] as const;

    // zapp out…
    const from = this.player.releasePoint();
    const fs = toScreen(this.player.x, from.d, this.player.airH + 1);
    flash(this, fs.sx, fs.sy, 30);
    burst(this, fs.sx, fs.sy, 24, ZAP, 260);

    this.tpReturnD = this.player.d;
    this.player.stop();
    this.player.x = dest.x;
    this.player.d = dest.d;
    this.player.airH = dest.h;
    this.player.control = "throwOnly";
    this.tpState = "levitate";
    this.tpTimer = T.tp.levitateS;

    // …zapp in
    const ts = toScreen(dest.x, dest.d, dest.h + 1);
    flash(this, ts.sx, ts.sy, 44);
    burst(this, ts.sx, ts.sy, 36, ZAP, 300);
    playSfx(this, "sfx_pop", 0.8);
  }

  private updateTeleportState(dt: number) {
    if (this.tpState === "levitate") {
      // suspended, drifting down a little — even while aiming
      this.player.airH -= T.tp.sinkSpeedM * dt;
      this.tpTimer -= dt;
      if (this.tpTimer <= 0) {
        if (this.aim.isAiming) {
          // time's up mid-aim: the ball squirts weakly straight up
          this.aim.cancel();
          this.throwBall({ vx: 0, vh: T.tp.weakThrowVh, power: 0 }, true);
        } else {
          this.startFall();
        }
      }
    } else if (this.tpState === "fall") {
      this.tpFallV += T.throw.gravityM * dt;
      this.player.airH -= this.tpFallV * dt;
      // drift back to the depth row they threw from
      this.player.d += (this.tpReturnD - this.player.d) * Math.min(1, 4 * dt);
      if (this.player.airH <= 0) {
        this.player.airH = 0;
        this.player.d = this.tpReturnD;
        this.tpState = "down";
        this.tpTimer = T.tp.lieS;
        playSfx(this, "sfx_bounce", 0.6);
        // face-plant: pivot over the feet onto the floor
        this.tweens.add({
          targets: this.player.sprite,
          angle: 90,
          duration: 240,
          ease: "Quad.easeIn",
        });
      }
    } else if (this.tpState === "down") {
      this.tpTimer -= dt;
      if (this.tpTimer <= 0) {
        this.tpState = "none";
        this.tweens.add({
          targets: this.player.sprite,
          angle: 0,
          duration: T.tp.getUpMs,
          ease: "Back.easeOut",
          onComplete: () => {
            this.player.control = "full";
          },
        });
      }
    }
  }

  private startFall() {
    this.tpState = "fall";
    this.tpFallV = 0;
    this.player.control = "none";
    if (this.aim.isAiming) this.aim.cancel();
  }

  private onScore(o: ShotOutcome, slam = false, rec?: ThrowRecording) {
    const pts = slam ? T.tp.slamPts : pointsForDistance(o.distM);
    const big = pts > T.score.bigScorePts;
    this.score += pts;
    this.hud.setScore(this.score);

    const j = T.juice;
    const { rimSX, rimSY } = this.hoop;
    netSnap(this, this.hoop.net);
    flash(this, rimSX, rimSY, big ? j.big.flashRadius : o.swish ? 34 : 24);
    const baseParticles = o.swish ? j.swishParticles : j.scoreParticles;
    burst(
      this,
      rimSX,
      rimSY + 6,
      Math.round(baseParticles * (big ? j.big.particleMult : 1)),
    );
    this.cameras.main.shake(
      big ? j.big.shakeMs : o.swish ? j.swishShakeMs : j.scoreShakeMs,
      big
        ? j.big.shakeIntensity
        : o.swish
          ? j.swishShakeIntensity
          : j.scoreShakeIntensity,
    );
    floatText(
      this,
      rimSX,
      rimSY - 26,
      slam
        ? `TELEPORT SLAM! +${pts}`
        : o.swish
          ? `SWISH! +${pts}`
          : `+${pts}`,
      big ? j.big.floatColor : o.swish ? "#ffb84d" : "#ffd97a",
      big ? j.big.floatSizePx : o.swish ? 22 : 18,
    );
    playSfx(this, o.swish ? "sfx_swish" : "sfx_score", 1);

    const d = o.distM.toFixed(1);
    const who = esc(this.playerName);
    // big lines are plain text — the rainbow gradient owns the whole line
    this.hud.log(
      "throw",
      slam
        ? `${who} — ${d}m teleport slam! ${o.swish ? "SWISH! " : ""}+${pts}`
        : big
          ? `${who} — ${d}m ${o.swish ? "SWISH! " : ""}+${pts}`
          : o.swish
            ? `${who} — ${d}m <span class="swish">SWISH!</span> <span class="pts">+${pts}</span>`
            : `${who} — ${d}m hit <span class="pts">+${pts}</span>`,
      big ? "bigscore" : undefined,
      rec ? () => this.ghost.play(rec) : undefined,
    );
  }

  private onMiss(o: ShotOutcome, slam = false, rec?: ThrowRecording) {
    this.hud.log(
      "throw",
      slam
        ? `${esc(this.playerName)} — teleport slam failed!`
        : `${esc(this.playerName)} — ${o.distM.toFixed(1)}m miss`,
      undefined,
      rec ? () => this.ghost.play(rec) : undefined,
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
