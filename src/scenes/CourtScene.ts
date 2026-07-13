import Phaser from "phaser";
import { T } from "../tuning";
import { M, RIM, floorDistToRim, floorY, screenToFloor, toScreen } from "../world";
import { burst, flash, puff } from "../juice";
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
import type {
  Cosmetics,
  HistoryEntry,
  PlayerInfo,
  ThrowLaunch,
  ThrowOutcome,
  WorldState,
} from "../shared/messages";
import type { Backend } from "../backend/types";
import {
  canUpgrade,
  effectivePowerForTier,
  getTier,
  hoopGeometryForTier,
  type HoopGeometry,
} from "../shared/tierRules";
import { showNotice } from "../settings";
import { TierDirector } from "../systems/tierDirector";
import { UpgradeButton, upgradeButtonSpot } from "../systems/upgradeButton";
import { CheerArea } from "../systems/cheerArea";
import type { BallLookId, FxKind } from "../shared/tierChanges";
import { RemoteAvatar } from "../remoteAvatar";
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
  private director!: TierDirector;
  private upgradeBtn!: UpgradeButton;
  private cheer?: CheerArea;
  private courtG!: Phaser.GameObjects.Graphics;
  /** the applied tier's ball tint — new balls spawn wearing it */
  private ballTint: number = T.ballLooks.classic;
  /** the latest authoritative world state (score + tier) */
  private world: WorldState = { sharedScore: 0, tierId: 1 };
  /** clicked the Upgrade button from afar — press on arrival */
  private pendingUpgradePress = false;
  /** server-reported daily budget; null until known (local = unlimited) */
  private throwsRemaining: number | null = null;
  private recsByThrowId = new Map<string, ThrowRecording>();
  /** live balls by throwId (own + remote) — popped on rejection/orb hit */
  private ballsByThrowId = new Map<string, Ball>();
  private remotes = new Map<
    string,
    { avatar: RemoteAvatar; bubbles: SpeechBubbles }
  >();

  /** pose telemetry cadence — send accumulated below */
  private poseAccum = 0;
  private lastPoseSent = "";
  private sincePoseSend = 0;

  constructor(
    private readonly hud: HUD,
    private readonly assets: AvailableAssets,
    /** per-lobby cosmetics (name, shirt, skin, head), resolved by main.ts */
    private readonly identity: Cosmetics,
    private readonly backend: Backend,
  ) {
    super("court");
  }

  private get playerName(): string {
    return this.identity.name;
  }

  /** The ACTIVE tier's hoop geometry — physics, camera and render share it. */
  private geom(): HoopGeometry {
    return hoopGeometryForTier(this.director?.tierId ?? 1);
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
    this.courtG = drawCourt(this, "standard");
    drawWall(this);
    this.keepOutZone = createKeepOutZone(this);
    this.hoop = createHoop(this, this.geom());
    this.director = new TierDirector(this, {
      rebuildHoop: (geom) => {
        this.hoop.destroy();
        this.hoop = createHoop(this, geom);
      },
      hoopFx: (fx) => this.hoopFx(fx),
      redrawCourt: (look, fx) => {
        this.courtG.destroy();
        this.courtG = drawCourt(this, look);
        if (fx && fx !== "none") this.courtSplash();
      },
      setBallLook: (look, fx) => this.applyBallLook(look, fx !== null),
      spawnInteractive: (el, animated) => {
        if (el.element === "cheer-area") {
          this.cheer ??= new CheerArea(this, this.player, el, () =>
            [...this.remotes.values()].map((r) => ({
              x: r.avatar.x,
              d: r.avatar.d,
            })),
          );
          this.cheer.spawn(animated);
        }
        // jukebox lands in step 7
      },
      clearInteractives: () => {
        this.cheer?.destroy();
        this.cheer = undefined;
      },
    });
    this.upgradeBtn = new UpgradeButton(this, () => this.tryUpgrade());
    this.sky = new SunSystem(this);
    this.player = new Player(this, this.playerName, this.identity);
    this.speech = new SpeechBubbles(this, this.player);
    this.aim = new AimController(
      this,
      this.player,
      (shot) => this.sendThrow(shot, false),
      (sx, sy) => this.walkClick(sx, sy),
      () => effectivePowerForTier(this.director.tierId),
    );
    this.teleport = new TeleportSystem(this, this.player, {
      aim: this.aim,
      throwWeak: () =>
        this.sendThrow({ vx: 0, vh: T.tp.weakThrowVh, power: 0 }, true),
      onTeleport: (from, to) => this.recording.noteTeleport(from, to),
      onOrbHit: (seq) => this.backend.reportOrbHit(seq),
    });
    this.recording = new RecordingSystem(
      this,
      { player: this.player, orb: this.teleport.orb, speech: this.speech },
      this.identity,
      () => replayMadeEffect(this, this.hoop),
    );
    this.rig = new CameraRig(this, this.player, () => this.geom());

    // dev console handle for poking at feel state while tuning
    (window as unknown as Record<string, unknown>).__court = this;

    // ── backend wiring: intents out, events in ─────────────────────
    this.backend.on("welcome", (e) => {
      this.selfId = e.selfId;
      this.renderHistory(e.history);
      this.hud.log("presence", `${esc(this.playerName)} joined the court.`);
      // a late joiner loads straight into the upgraded world
      this.director.applyInstant(e.world.tierId);
      this.setWorld(e.world);
      this.hud.setThrowsRemaining(e.throwsRemaining);
      // gates immediately if we rejoin with 0 left
      this.throwsRemaining = e.throwsRemaining;
      if (e.orb) this.teleport.orb.show(e.orb);
      for (const p of e.players) {
        if (p.id !== e.selfId) {
          this.addRemote(p);
        } else {
          // the AUTHORITY rolled our spawn spot — stand where everyone
          // else will see us, and puff in
          this.player.stop();
          this.player.x = p.x;
          this.player.d = p.d;
          this.spawnPuff(p.x, p.d);
        }
      }
    });
    this.backend.on("budget", (e) => {
      // the authority (server room / LocalBackend) recounted — gate on it
      this.throwsRemaining = e.throwsRemaining;
      this.hud.setThrowsRemaining(e.throwsRemaining);
    });
    this.backend.on("joinRejected", () => {
      this.hud.log("presence", "This court is full — try again later.");
    });
    this.backend.on("disconnected", () => {
      this.hud.log("presence", "Connection to the court lost.");
    });
    this.backend.on("lobbyRemoved", () => {
      // a kick, not a network drop — the backend suppressed `disconnected`
      showNotice(
        "Court closed",
        "This lobby was removed manually by the admin.",
        { label: "Play offline", href: location.pathname },
      );
    });
    this.backend.on("playerJoined", (e) => {
      this.addRemote(e.player);
      this.spawnPuff(e.player.x, e.player.d); // a new character appears
      this.hud.log("presence", `${esc(e.player.name)} joined the court.`);
    });
    this.backend.on("playerLeft", (e) => {
      this.removeRemote(e.id);
      this.hud.log("presence", `${esc(e.name)} left the court.`);
    });
    this.backend.on("playerMoved", (e) => {
      if (e.id !== this.selfId) this.remotes.get(e.id)?.avatar.walkTo(e.x, e.d);
    });
    this.backend.on("playerPosed", (e) => {
      if (e.id !== this.selfId) this.remotes.get(e.id)?.avatar.pushSample(e.s);
    });
    this.backend.on("throwStarted", (e) => {
      if (e.id === this.selfId) {
        this.spawnBall(e.throwId, e.launch);
      } else {
        this.spawnRemoteBall(e.throwId, e.launch);
        // if they were levitating, this throw is their last act up there
        this.remotes.get(e.id)?.avatar.onThrowReleased();
      }
    });
    this.backend.on("outcome", (e) => this.presentOutcome(e));
    this.backend.on("throwRejected", (e) => {
      // the optimistic ball was cosmetic — pop it, nothing can come of it
      this.ballsByThrowId.get(e.throwId)?.consume();
      this.hud.log(
        "presence",
        e.reason === "budget"
          ? "Out of throws for today — come back tomorrow!"
          : "The court rejected that throw.",
      );
    });
    // ── the orb is a server-authoritative world object ──────────────
    this.backend.on("orbSpawned", (e) => this.teleport.orb.show(e.orb));
    this.backend.on("orbRemoved", (e) => {
      this.teleport.orb.removeBySeq(e.seq, e.byId !== undefined);
    });
    this.backend.on("teleported", (e) => {
      // the ball that hit the orb is spent, on every screen
      if (e.throwId) this.ballsByThrowId.get(e.throwId)?.consume();
      if (e.id === this.selfId) {
        // usually we predicted this locally — then it's a no-op
        this.teleport.confirmTeleport({ x: e.x, d: e.d, h: e.h });
      } else {
        this.remotes.get(e.id)?.avatar.teleportTo(e.x, e.d, e.h);
      }
    });
    this.backend.on("chatMessage", (e) => {
      this.hud.log(
        "chat",
        `<span class="who">${esc(e.name)}:</span> ${esc(e.text)}`,
      );
      if (e.id === this.selfId) this.speech.say(e.text);
      else this.remotes.get(e.id)?.bubbles.say(e.text);
      playSfx(this, "sfx_chat", 0.5);
    });
    this.backend.on("worldReset", (e) => {
      this.director.applyInstant(e.world.tierId);
      this.setWorld(e.world);
      this.hud.log("world", `${esc(e.name)} reset the court score.`);
    });
    this.backend.on("upgraded", (e) => this.onUpgraded(e));
    this.backend.on("snapshot", (e) => {
      // self-heal: a missed upgrade event is corrected by the next snapshot
      this.director.applyInstant(e.world.tierId);
      this.setWorld(e.world);
      // orb self-heal is adopt-only: removal has its own ordered event,
      // and show() ignores seqs we already removed locally
      if (e.orb) this.teleport.orb.show(e.orb);
      for (const p of e.players) {
        if (p.id === this.selfId) continue;
        const r = this.remotes.get(p.id);
        if (r) r.avatar.setPos(p.x, p.d);
        else this.addRemote(p); // self-heal: we somehow missed the join
      }
      for (const [id, r] of this.remotes) {
        if (!e.players.some((p) => p.id === id)) {
          r.avatar.destroy();
          this.remotes.delete(id);
        }
      }
    });

    // throw yielding: a right-click while cheering walks the character
    // back out of the area (PLACEHOLDER: the player re-aims once out —
    // replaying the exact aim gesture after the walk isn't possible)
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown() && this.cheer?.active) {
        this.cheer.leaveThen(() => {});
      }
    });

    this.hud.onChat((msg) => this.backend.chat(msg));
    this.backend.connect();
  }

  /** One hoop-change beat landed: the pop-with-splash at the hoop. */
  private hoopFx(fx: FxKind) {
    const { rimSX, rimSY } = this.hoop.rims[0]; // the top-most rim
    if (fx === "pop" || fx === "pop-splash") {
      flash(this, rimSX, rimSY, 46);
      this.cameras.main.shake(140, 0.006);
    }
    if (fx === "splash" || fx === "pop-splash") {
      burst(this, rimSX, rimSY + 8, 40, [0x9fd0ff, 0xfdf6e3, 0xffffff], 260);
    }
    playSfx(this, "sfx_pop", 0.9);
  }

  /** The court reskin's splash — a sweep of bursts across the floor. */
  private courtSplash() {
    const y = floorY(RIM.d);
    for (const fx of [0.2, 0.5, 0.8]) {
      const x = fx * T.court.lengthM * M;
      burst(this, x, y, 30, [0xfdf6e3, 0xffffff, 0xffd97a], 240);
    }
    flash(this, (T.court.lengthM / 2) * M, y, 120);
    this.cameras.main.shake(200, 0.005);
    playSfx(this, "sfx_bounce", 0.8);
  }

  /** The tier's ball look, everywhere at once (world, held, UI icons). */
  private applyBallLook(look: BallLookId, animated: boolean) {
    this.ballTint = T.ballLooks[look] ?? T.ballLooks.classic;
    this.player.rig.setBallTint(this.ballTint);
    for (const r of this.remotes.values()) r.avatar.rig.setBallTint(this.ballTint);
    this.hud.setBallLook(look !== "classic", animated);
    if (animated) playSfx(this, "sfx_pop", 0.8);
  }

  /** Track the authoritative world; the Upgrade button follows it. */
  private setWorld(w: WorldState) {
    this.world = w;
    this.hud.setScore(w.sharedScore);
    this.upgradeBtn.setAvailable(canUpgrade(w));
  }

  /**
   * The server validates the presser against upgrade.proximityM using its
   * OWN view of the position, which lags a pose tick (~0.4 m at walk
   * speed) — so the client only presses when comfortably inside.
   */
  private static readonly PRESS_DIST = T.upgrade.proximityM * 0.6;

  /** The Upgrade button was clicked: press if close, walk over if not. */
  private tryUpgrade() {
    const spot = upgradeButtonSpot();
    const dist = Math.hypot(this.player.x - spot.x, this.player.d - spot.d);
    if (dist <= CourtScene.PRESS_DIST) {
      this.backend.upgrade();
    } else {
      // walk up to the button, press on arrival (see update())
      this.pendingUpgradePress = true;
      this.player.walkTo(spot.x, spot.d);
      this.backend.moveTo(spot.x, spot.d);
    }
  }

  /** A player pressed Upgrade: VFX burst, teleport clear, transform. */
  private onUpgraded(e: {
    tierId: number;
    world: WorldState;
    byName: string;
    placements: { id: string; x: number; d: number }[];
  }) {
    this.pendingUpgradePress = false;
    this.setWorld(e.world);
    // a burst of VFX — lots, all at once
    const { rimSX, rimSY } = this.hoop.primary;
    flash(this, rimSX, rimSY, 90);
    burst(this, rimSX, rimSY, 110);
    this.cameras.main.shake(500, 0.02);
    playSfx(this, "sfx_swish", 1);
    // all active players teleported clear of the hoop
    for (const p of e.placements) {
      if (p.id === this.selfId) {
        this.player.stop();
        this.player.x = p.x;
        this.player.d = p.d;
      } else {
        this.remotes.get(p.id)?.avatar.setPos(p.x, p.d);
      }
      this.spawnPuff(p.x, p.d);
    }
    // the tier's ordered change list plays out as choreography
    this.director.playUpgrade(e.tierId);
    const tier = getTier(e.tierId);
    this.hud.log(
      "world",
      `${esc(e.byName)} upgraded the court — Hoop ${e.tierId}: ${esc(tier?.name ?? "")}!`,
    );
  }

  private addRemote(p: PlayerInfo) {
    if (this.remotes.has(p.id)) return;
    const avatar = new RemoteAvatar(this, p);
    avatar.rig.setBallTint(this.ballTint); // joiners wear the tier's look
    this.remotes.set(p.id, { avatar, bubbles: new SpeechBubbles(this, avatar) });
  }

  /** Appear-VFX at a floor spot (character mid-height). */
  private spawnPuff(x: number, d: number) {
    const { sx, sy } = toScreen(x, d, 0);
    puff(this, sx, sy);
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.avatar.destroy();
    this.remotes.delete(id);
  }

  /** The persistent court wall: lines that happened before we joined. */
  private renderHistory(entries: HistoryEntry[]) {
    for (const h of entries) {
      if (h.kind === "chat") {
        this.hud.log(
          "chat",
          `<span class="who">${esc(h.name)}:</span> ${esc(h.text)}`,
        );
      } else if (h.kind === "presence") {
        this.hud.log(
          "presence",
          `${esc(h.name)} ${h.joined ? "joined" : "left"} the court.`,
        );
      } else if (h.kind === "reset") {
        this.hud.log("world", `${esc(h.name)} reset the court score.`);
      } else if (h.kind === "upgrade") {
        this.hud.log(
          "world",
          `${esc(h.name)} upgraded the court to Hoop ${h.tierId}.`,
        );
      } else {
        const d = h.distM.toFixed(1);
        const who = esc(h.name);
        this.hud.log(
          "throw",
          h.made
            ? `${who} — ${d}m ${h.slam ? "teleport slam! " : ""}${h.swish ? "SWISH! " : "hit "}<span class="pts">+${h.points}</span>`
            : h.slam
              ? `${who} — teleport slam failed!`
              : `${who} — ${d}m miss`,
          h.made ? undefined : "miss",
        );
      }
    }
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.05);
    this.sky.update(dt);
    const light = this.sky.lightDir();
    this.player.update(dt, light);
    this.speech.update(dt);
    for (const r of this.remotes.values()) {
      r.avatar.update(dt, light);
      r.bubbles.update(dt);
    }
    this.aim.update();
    this.cheer?.update(dt);
    for (const b of this.balls) b.update(dt, light);
    this.teleport.update(dt, this.balls);
    this.recording.update(dt);

    this.balls = this.balls.filter((b) => !b.done);
    this.rig.update(dt);

    // clicked Upgrade from afar → walking over; press when close enough
    if (this.pendingUpgradePress) {
      const spot = upgradeButtonSpot();
      const dist = Math.hypot(this.player.x - spot.x, this.player.d - spot.d);
      if (dist <= CourtScene.PRESS_DIST) {
        this.pendingUpgradePress = false;
        if (canUpgrade(this.world)) this.backend.upgrade();
      }
    }

    // ── pose telemetry: ~12 Hz while animating, slow keep-alive when
    // still (a held pose must not go stale on the other screens) ──────
    this.poseAccum += dt;
    this.sincePoseSend += dt;
    if (this.poseAccum >= 1 / 12) {
      this.poseAccum = 0;
      const s = this.player.visualState();
      const enc = JSON.stringify(s);
      if (enc !== this.lastPoseSent || this.sincePoseSend >= 0.4) {
        this.lastPoseSent = enc;
        this.sincePoseSend = 0;
        this.backend.sendPose(s);
      }
    }

    // keep-out zone fades in only when the player is pressed up close
    const zoneX = (RIM.x - T.move.hoopStandoffM) * M;
    const near = zoneX - this.player.x * M <= T.zone.showDistPx;
    const kz = 1 - Math.exp(-T.zone.fadeLerp * dt);
    this.keepOutZone.alpha += ((near ? 1 : 0) - this.keepOutZone.alpha) * kz;

    // hoop drop shadow tracks the sun (caster ≈ mid-height of the top rim)
    this.hoop.shadow.x =
      RIM.x * M + 8 + shadowShift(this.geom().rims[0].h * 0.5, light);
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
    if (this.throwsRemaining !== null && this.throwsRemaining <= 0) {
      // the server would reject it and nobody else would see it — don't
      // fake a flight that doesn't exist for the rest of the court
      this.hud.log("presence", "Out of throws for today — come back tomorrow!");
      this.teleport.onThrowReleased(); // a blocked slam still ends the levitation
      return;
    }
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
    // random suffix: throwIds must not collide ACROSS clients — everyone
    // sees everyone's ids (outcomes, orb-consumed balls)
    const throwId = `t${++this.throwSeq}-${Math.random().toString(36).slice(2, 8)}`;
    this.backend.requestThrow(throwId, launch);
    // follow-through sweep along the real launch direction
    this.player.startThrow(Math.atan2(shot.vh, shot.vx), shot.power);
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
      own: true,
      geom: () => this.geom(),
      tint: this.ballTint,
      onScore: (o) => {
        this.recording.stampOutcome(rec, true);
        this.backend.reportOutcome(throwId, {
          made: true,
          swish: o.swish,
          slam: launch.slam,
          rims: o.rims,
          distM: o.distM,
        });
      },
      onMiss: (o) => {
        this.recording.stampOutcome(rec, false);
        this.backend.reportOutcome(throwId, {
          made: false,
          swish: false,
          slam: launch.slam,
          rims: 0,
          distM: o.distM,
        });
      },
      onDone: () => {
        this.ballsByThrowId.delete(throwId);
      },
    });
    rec = this.recording.beginThrow(
      ball,
      launch.slam,
      this.playerName,
      this.director.ballLook, // the recolour rule stamps record time
    );
    this.recsByThrowId.set(throwId, rec);
    this.ballsByThrowId.set(throwId, ball);
    this.balls.push(ball);
  }

  /** A remote player's throw — animate it from the launch params. */
  private spawnRemoteBall(throwId: string, launch: ThrowLaunch) {
    const ball = new Ball(this, {
      x: launch.x,
      d: launch.d,
      h: launch.h,
      vx: launch.vx,
      vh: launch.vh,
      shotDistM: floorDistToRim(launch.shotX, launch.shotD),
      own: false, // never triggers OUR power-ups; the server rules theirs
      geom: () => this.geom(),
      tint: this.ballTint,
      // cosmetic: the server's outcome event carries the result
      onScore: () => {},
      onMiss: () => {},
      onDone: () => {
        this.ballsByThrowId.delete(throwId);
      },
    });
    this.ballsByThrowId.set(throwId, ball);
    this.balls.push(ball);
  }

  /** The authoritative result came back — score display + juice + log. */
  private presentOutcome(e: ThrowOutcome) {
    this.setWorld(e.world);
    // recordings exist only for OWN throws — never match a remote outcome
    const rec =
      e.playerId === this.selfId ? this.recsByThrowId.get(e.throwId) : undefined;
    this.recsByThrowId.delete(e.throwId);
    const onReplay = rec ? () => this.recording.play(rec) : undefined;
    const who =
      e.playerId === this.selfId
        ? this.playerName
        : (this.remotes.get(e.playerId)?.avatar.name ?? "Someone");
    const ctx = { scene: this, hud: this.hud, hoop: this.hoop, who };
    const o = { made: e.made, swish: e.swish, rims: e.rims, distM: e.distM };
    if (e.made) presentScore(ctx, o, e.points, e.slam, onReplay);
    else presentMiss(ctx, o, e.slam, onReplay);
  }

  // ── movement: animate immediately, broadcast the intent ───────────

  private walkClick(sx: number, sy: number) {
    this.pendingUpgradePress = false; // walking elsewhere cancels the errand
    const { x, d } = screenToFloor(sx, sy);
    this.clickRipple(sx, sy);
    // yielding: a cheering character first walks back down out of the
    // area, then obeys the click
    if (
      this.cheer?.leaveThen(() => {
        this.player.walkTo(x, d);
        this.backend.moveTo(x, d);
      })
    )
      return;
    this.backend.moveTo(x, d);
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
