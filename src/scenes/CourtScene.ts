import Phaser from "phaser";
import { T } from "../tuning";
import {
  M,
  RIM,
  floorDistToRim,
  floorY,
  multiplyTint,
  screenToFloor,
  toScreen,
} from "../world";
import {
  announceText,
  burst,
  flash,
  floatText,
  netSnap,
  puff,
  tierTitle,
} from "../juice";
import { rimPoints } from "../shared/scoring";
import { SunSystem, shadowShift } from "../sky";
import { SpeechBubbles } from "../speech";
import type { HUD } from "../hud";
import { esc, linkify } from "../hud";
import {
  ballTexture,
  ballTintFor,
  createHoop,
  createKeepOutZone,
  drawBackdrop,
  drawCourt,
  drawWall,
  ensurePlaceholderTextures,
  type Backdrop,
  type HoopParts,
} from "../placeholders";
import { Player } from "../player";
import { CameraRig } from "../cameraRig";
import { AimController, playerRingHit, type Shot } from "../aiming";
import { isMobileDevice } from "../mobile";
import { runChatCommand } from "../commands";
import { Ball } from "../ball";
import { type BallState, fastForwardBall } from "../shared/physics";
import { hoopGeometryAt, motionLiftAt } from "../shared/hoopMotion";
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
  ballLookForTier,
  BASE_ATMOSPHERE,
  canUpgrade,
  clampToWalkable,
  effectivePowerForTier,
  getTier,
  hoopGeometryForTier,
  hoopMotionForTier,
  interactivesForTier,
  nextTier,
  requiredScore,
  type Atmosphere,
  type HoopGeometry,
} from "../shared/tierRules";
import { showNotice } from "../settings";
import { showControlsPopup } from "../controlsPopup";
import type { ShareTracker } from "../share";
import { TierDirector } from "../systems/tierDirector";
import { UpgradeButton, upgradeButtonSpot } from "../systems/upgradeButton";
import { CheerArea } from "../systems/cheerArea";
import { Jukebox } from "../systems/jukebox";
import { IdleWatch } from "../systems/afk";
import { orbTimingForTier } from "../shared/tierRules";
import type { BallLookId, FxKind } from "../shared/tierChanges";
import { RemoteAvatar } from "../remoteAvatar";
import { TeleportSystem } from "../systems/teleport";
import { RecordingSystem } from "../systems/recording";
import {
  presentCatch,
  presentMiss,
  presentScore,
  replayMadeEffect,
} from "../systems/shotFeedback";

/** One of OUR live throws - drives the catch-the-ball window. */
interface OwnThrow {
  ball: Ball;
  rec: ThrowRecording;
  /** the LOCAL ball ruled a miss - the catch window is open */
  missed: boolean;
  /** thrown with a caught ball - can never be caught again */
  bornFromCatch: boolean;
  caught: boolean;
}

// The court itself: builds the world, wires the systems together, and owns
// the frame order. Feature logic lives in the systems -
//   systems/teleport.ts     the orb power-up + levitation state machine
//   systems/recording.ts    ghost record capture + playback
//   systems/shotFeedback.ts score/miss juice + the court-wall log lines
// the ball's physics is the pure stepper in shared/physics.ts, and ALL
// gameplay intents/outcomes flow through the Backend seam - the scene
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
  private jukebox?: Jukebox;
  private idle!: IdleWatch;
  private courtG!: Phaser.GameObjects.Graphics;
  /** the atmosphere's camera wash - re-fit to the camera every frame */
  private atmosOverlay!: Phaser.GameObjects.Rectangle;
  private backdrop!: Backdrop;
  /** the sky's CURRENT colour + its cross-fade tween state */
  private skyColor = BASE_ATMOSPHERE.sky;
  private readonly skyFade = { t: 0 };
  /** the applied tier's ball look + tint - new balls spawn wearing them */
  private ballLook: BallLookId = "classic";
  private ballTint: number = T.ballLooks.classic;
  /** the latest authoritative world state (score + tier) */
  private world: WorldState = { sharedScore: 0, tierId: 1 };
  /** clicked the Upgrade button from afar - press on arrival */
  private pendingUpgradePress = false;
  /** the tier-4 carriage ride is VISIBLE (a live show holds it until
   *  the start-moving beat; physics runs the motion regardless) */
  private hoopMotionVisible = false;
  /** the rack as this client knows it (authority + local regen sim);
   *  null until the first welcome */
  private throwsRemaining: number | null = null;
  /** epoch ms when the next ball lands (null at cap) - drives the
   *  local regen sim and the hourglass countdown */
  private regenDeadlineMs: number | null = null;
  /** the first applyBudget pops from the persisted last-seen count */
  private budgetSeenOnce = false;
  private recsByThrowId = new Map<string, ThrowRecording>();
  /** live balls by throwId (own + remote) - popped on rejection/orb hit */
  private ballsByThrowId = new Map<string, Ball>();
  /** remote throws that started while this tab was HIDDEN - flushed as
   *  fast-forwarded balls on return (owner 2026-07-17); an entry dies
   *  the moment its outcome/caught/teleported event arrives */
  private hiddenRemoteThrows = new Map<
    string,
    { launch: ThrowLaunch; atMs: number }
  >();
  /** OUR live throws - the catch-the-ball bookkeeping */
  private ownThrows = new Map<string, OwnThrow>();
  /** miss lines held back while the ball can still be caught */
  private pendingMisses = new Map<
    string,
    { present: () => void; timeoutId: number }
  >();
  /** catches banked: the NEXT own throw is born-from-catch (once per ball) */
  private catchCredits = 0;
  private remotes = new Map<
    string,
    { avatar: RemoteAvatar; bubbles: SpeechBubbles }
  >();

  /** pose telemetry cadence - send accumulated below */
  private poseAccum = 0;
  private lastPoseSent = "";
  private sincePoseSend = 0;

  constructor(
    private readonly hud: HUD,
    private readonly assets: AvailableAssets,
    /** per-lobby cosmetics (name, shirt, skin, head), resolved by main.ts */
    private readonly identity: Cosmetics,
    private readonly backend: Backend,
    /** the lobby id (null offline) - keys the per-lobby seen-tier store */
    private readonly lobby: string | null = null,
    /** the player JUST chose their name (no stored one) - a first entry,
     *  so the controls pop-up follows the name modal */
    private readonly firstEntry: boolean = false,
    /** the top-center SHARE button - fed the local player's hits */
    private readonly share: ShareTracker = {
      noteResult() {},
      setWorldProgress() {},
    },
  ) {
    super("court");
  }

  // ── the seen-tier store: which tier this player last SAW here ──────
  // A reload or rejoin compares it against the world's tier: if the
  // world upgraded while the player was away, the missed transformation
  // plays as a catch-up show instead of silently loading the new world
  // (the AFK catch-up promise of HOOP_PROGRESSION.md, extended to
  // players who closed the tab entirely).

  private get seenTierKey(): string {
    return this.lobby
      ? `shootDaHoop.seenTier.${this.lobby}`
      : "shootDaHoop.seenTier";
  }

  private loadSeenTier(): number | null {
    const n = Number(localStorage.getItem(this.seenTierKey));
    return Number.isInteger(n) && n >= 1 ? n : null;
  }

  private rememberSeenTier() {
    localStorage.setItem(this.seenTierKey, String(this.director.tierId));
  }

  private get playerName(): string {
    return this.identity.name;
  }

  /** The ACTIVE tier's hoop geometry - physics, camera and render share it. */
  /** The camera's framing envelope: the active tier's hoop, grown to
   *  the TOP of its travel when the tier moves - the camera frames the
   *  whole ride instead of chasing the carriage every frame. */
  private geom(): HoopGeometry {
    const tier = this.director?.tierId ?? 1;
    const base = hoopGeometryForTier(tier);
    const spec = hoopMotionForTier(tier);
    if (!spec) return base;
    return {
      ...base,
      rims: base.rims.map((r) => ({ ...r, h: r.h + spec.travelM })),
      boardTopM: base.boardTopM + spec.travelM,
    };
  }

  /** The carriage lift RIGHT NOW, meters - 0 while hoops stand still or
   *  the show hasn't reached its start-moving beat yet. */
  private currentLift(): number {
    if (!this.hoopMotionVisible) return 0;
    const spec = hoopMotionForTier(this.director?.tierId ?? 1);
    const state = this.world.hoopMotion;
    if (!spec || !state) return 0;
    return motionLiftAt(spec, state, Date.now());
  }

  /**
   * A ball's per-step hoop geometry: the ACTIVE tier (an upgrade
   * mid-flight is picked up next step, as before), positioned on the
   * moving hoop's shared timeline from the launch stamp - so this
   * flight IS the trajectory the server resolved. Still hoops degrade
   * to the cached static geometry inside hoopGeometryAt.
   */
  private flightGeom(launch: ThrowLaunch): (simTimeS: number) => HoopGeometry {
    const launchAtMs = launch.atMs ?? Date.now();
    return (simTimeS) =>
      hoopGeometryAt(
        this.director?.tierId ?? 1,
        this.world.hoopMotion,
        launchAtMs + simTimeS * 1000,
      );
  }

  preload() {
    // only assets that were probed to exist - everything else is a placeholder
    for (const key of this.assets.images)
      this.load.image(key, `assets/${key}.webp`);
    for (const key of this.assets.audio)
      this.load.audio(key, [`assets/${key}.wav`]);
    // NOTE: jukebox music is deliberately NOT loaded through Phaser -
    // the tracks are hour-long mixes, and WebAudio's decodeAudioData
    // would inflate them to gigabytes of PCM. The Jukebox streams them
    // through an HTMLAudioElement instead (systems/jukebox.ts).
  }

  create() {
    // hidden/blurred tabs keep HEARING the jukebox: this flag only stops
    // the SoundManager pausing - Phaser's game-loop pause on blur (which
    // the AFK catch-up and snap-to-now behaviours rely on) is untouched.
    // Note: with the clock paused, a song's `complete` handler may only
    // run on tab return; WebAudio itself plays to the end regardless.
    this.sound.pauseOnBlur = false;
    ensurePlaceholderTextures(this);
    this.backdrop = drawBackdrop(this);
    this.courtG = drawCourt(this, "standard");
    drawWall(this);
    this.keepOutZone = createKeepOutZone(this);
    this.hoop = createHoop(this, this.geom());
    this.updateHoopScreen(); // fresh world: "0 / <tier-2 threshold>"
    this.director = new TierDirector(this, {
      setHoopMotionVisible: (on) => {
        this.hoopMotionVisible = on;
        if (!on) this.hoop?.setLift(0);
      },
      rebuildHoop: (geom, look) => {
        this.hoop.destroy();
        this.hoop = createHoop(this, geom, look, {
          // pole headroom so the tier-4 carriage never rides off the top
          liftHeadroomM:
            hoopMotionForTier(this.director?.tierId ?? 1)?.travelM ?? 0,
        });
        // a rebuild lands at rest height - re-seat the carriage NOW or
        // the hoop pops to its base for a frame on every choreo beat
        this.hoop.setLift(this.currentLift());
        this.updateHoopScreen(); // the foot screen survives every rebuild
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
        } else if (el.element === "jukebox") {
          this.jukebox ??= new Jukebox(
            this,
            this.player,
            el,
            this.assets.music,
            () => this.backend.jukeboxPress(),
            () => this.backend.jukeboxOffPress(),
          );
          this.jukebox.spawn(animated);
          // the deferred AFK catch-up show spawns the box AFTER the
          // welcome sync ran into nothing - adopt the persisted song now
          // (seeked); sync dedupes on startedAtMs so this is idempotent
          this.jukebox.sync(this.world.jukebox);
        }
      },
      clearInteractives: () => {
        this.cheer?.destroy();
        this.cheer = undefined;
        this.jukebox?.destroy();
        this.jukebox = undefined;
      },
      showFinished: (tierId) => tierTitle(this, tierId),
      setAtmosphere: (a, fx, fadeMs) =>
        this.applyAtmosphere(a, fx !== null && fx !== "none", fadeMs),
    });
    // the wash sits over the whole world (world objects top out at the
    // aim preview's 900) but under the DOM HUD, which is above the canvas
    this.atmosOverlay = this.add
      .rectangle(0, 0, 4, 4, 0x000000, 0)
      .setOrigin(0)
      .setDepth(950);
    this.upgradeBtn = new UpgradeButton(this, () => this.tryUpgrade());
    this.idle = new IdleWatch(T.progressionFx.afkTimeoutS, () => {
      // the AFK player is back - the held transformation plays now
      if (this.director.hasDeferred) this.playUpgradeShow(null);
    });
    this.sky = new SunSystem(this);
    this.player = new Player(this, this.playerName, this.identity);
    this.speech = new SpeechBubbles(this, this.player);
    this.aim = new AimController(
      this,
      this.player,
      (shot) => this.sendThrow(shot, false),
      (sx, sy) => this.walkClick(sx, sy),
      () => effectivePowerForTier(this.director.tierId),
      () => ballLookForTier(this.director.tierId),
      () => this.throwsRemaining !== null && this.throwsRemaining <= 0,
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
      () => this.director.tierId,
      // a replay from another tier scores on ITS ghost hoop, not ours
      (ghostHoop) => replayMadeEffect(this, ghostHoop ?? this.hoop),
      // a finished recording ships to the authority: the wall line then
      // replays on EVERY screen, and survives restarts (owner 2026-07-17)
      (rec) => {
        if (rec.throwId && !rec.evicted)
          this.backend.saveRecording(rec.throwId, rec);
      },
    );
    this.rig = new CameraRig(this, this.player, () => this.geom());

    // dev console handle for poking at feel state while tuning
    (window as unknown as Record<string, unknown>).__court = this;

    // ── backend wiring: intents out, events in ─────────────────────
    this.backend.on("welcome", (e) => {
      this.selfId = e.selfId;
      this.renderHistory(e.history);
      this.hud.log(
        "presence",
        `${this.nameHtml(this.playerName)} joined the court.`,
      );
      const seen = this.loadSeenTier();
      if (seen !== null && seen < e.world.tierId) {
        // the world upgraded while this player was AWAY (tab closed):
        // rebuild it as they last saw it, hold, and play the missed
        // transformation - the AFK catch-up, surviving a reload
        this.director.applyInstant(seen);
        this.director.deferUpgrade(e.world.tierId);
        // PLACEHOLDER (tune): a beat to land in the old world first
        this.time.delayedCall(1000, () => {
          if (this.director.hasDeferred) this.playUpgradeShow(null);
        });
      } else {
        // a first-time joiner loads straight into the upgraded world
        this.director.applyInstant(e.world.tierId);
      }
      this.setWorld(e.world);
      this.jukebox?.sync(e.world.jukebox); // land mid-song like everyone
      // AFK earnings arrive here - the pop stagger plays off the
      // last-seen baseline inside applyBudget
      this.applyBudget(e.throwsRemaining, e.nextBallInS);
      if (e.orb) this.teleport.orb.show(e.orb);
      for (const p of e.players) {
        if (p.id !== e.selfId) {
          this.addRemote(p);
        } else {
          // the AUTHORITY rolled our spawn spot - stand where everyone
          // else will see us, and puff in
          this.player.stop();
          this.player.x = p.x;
          this.player.d = p.d;
          this.spawnPuff(p.x, p.d);
        }
      }
    });
    this.backend.on("budget", (e) => {
      // the authority (server room / LocalBackend) recounted - gate on
      // it; this also cancels any local pop stagger and re-targets
      this.applyBudget(e.throwsRemaining, e.nextBallInS);
    });

    // ── the local regen sim: between authoritative messages the client
    // advances its own rack off the deadline the authority sent. THIS
    // is what lets a player at zero throw again without a reload - the
    // sendThrow gate and the aim's out-of-balls pose read the field.
    // A DOM interval (hidden tabs pause Phaser's clock), deadline-based
    // (throttled tabs fire late - the while loop banks the arrears),
    // chaining each next deadline from the LAPSED one to stay aligned
    // with the server's anchor. Drift is resynced by the reject path.
    const regenTick = () => {
      let changed = false;
      while (
        this.regenDeadlineMs !== null &&
        Date.now() >= this.regenDeadlineMs &&
        this.throwsRemaining !== null &&
        this.throwsRemaining < T.budget.ballCap
      ) {
        this.throwsRemaining += 1;
        this.regenDeadlineMs =
          this.throwsRemaining < T.budget.ballCap
            ? this.regenDeadlineMs + T.budget.regenMinutes * 60_000
            : null;
        changed = true;
      }
      if (changed) {
        this.rememberBallsSeen(this.throwsRemaining ?? 0);
        this.hud.setBudget(this.throwsRemaining ?? 0, this.regenDeadlineMs);
      }
    };
    const regenTimer = window.setInterval(regenTick, 500);
    this.events.once("shutdown", () => clearInterval(regenTimer));
    this.backend.on("joinRejected", () => {
      this.hud.log("presence", "This court is full - try again later.");
    });
    this.backend.on("disconnected", () => {
      this.hud.log("presence", "Connection to the court lost.");
    });
    this.backend.on("lobbyRemoved", () => {
      // a kick, not a network drop - the backend suppressed `disconnected`
      showNotice(
        "Court closed",
        "This lobby was removed manually by the admin.",
        { label: "Play offline", href: location.pathname },
      );
    });
    this.backend.on("playerJoined", (e) => {
      const existing = this.remotes.get(e.player.id);
      if (existing) {
        // a returning player reclaims their waiting character in place
        existing.avatar.setOffline(false);
        this.spawnPuff(existing.avatar.x, existing.avatar.d);
        this.hud.log("presence", `${esc(e.player.name)} is back at the court.`);
        return;
      }
      this.addRemote(e.player);
      this.spawnPuff(e.player.x, e.player.d); // a new character appears
      this.hud.log("presence", `${esc(e.player.name)} joined the court.`);
    });
    this.backend.on("playerLeft", (e) => {
      // legacy/edge path - normal disconnects now go playerWentOffline
      this.removeRemote(e.id);
      this.hud.log("presence", `${this.nameHtml(e.name)} left the court.`);
    });
    this.backend.on("playerWentOffline", (e) => {
      // the character STAYS and waits - only the tag changes
      this.remotes.get(e.id)?.avatar.setOffline(true);
      this.hud.log(
        "presence",
        `${this.nameHtml(e.name)} left the court - their character waits around.`,
      );
    });
    this.backend.on("playerMoved", (e) => {
      if (e.id === this.selfId) return;
      // clamp to the tier's WALKABLE space (court + cheer deck) - the
      // offline waiting walk targets the off-court deck
      const c = clampToWalkable(e.x, e.d, this.director.tierId);
      this.remotes.get(e.id)?.avatar.walkTo(c.x, c.d);
    });
    this.backend.on("playerPosed", (e) => {
      if (e.id !== this.selfId) this.remotes.get(e.id)?.avatar.pushSample(e.s);
    });
    this.backend.on("throwStarted", (e) => {
      if (e.id === this.selfId) {
        this.spawnBall(e.throwId, e.launch);
      } else {
        // a hidden tab's game loop is paused: a ball spawned now would
        // fly when the player comes back - queue it instead, and the
        // visibilitychange flush spawns it FAST-FORWARDED to where every
        // live screen has it (owner 2026-07-17: "I can't view other
        // players' throws - my browser wasn't focused")
        if (!document.hidden) this.spawnRemoteBall(e.throwId, e.launch);
        else
          this.hiddenRemoteThrows.set(e.throwId, {
            launch: e.launch,
            atMs: performance.now(),
          });
        // if they were levitating, this throw is their last act up there
        this.remotes.get(e.id)?.avatar.onThrowReleased();
      }
    });
    this.backend.on("outcome", (e) => this.presentOutcome(e));
    this.backend.on("caught", (e) => {
      // the authority confirmed a catch: it never was a miss - the held
      // line dies on every screen and the catch line logs instead
      this.hiddenRemoteThrows.delete(e.throwId); // resolved - never flush
      this.dropPendingMiss(e.throwId);
      // remote screens may still show the cosmetic ball bouncing - pop it
      // (the catcher's own ball already popped in doCatch)
      if (e.id !== this.selfId) this.ballsByThrowId.get(e.throwId)?.consume();
      const rec =
        e.id === this.selfId ? this.recsByThrowId.get(e.throwId) : undefined;
      this.recsByThrowId.delete(e.throwId);
      const who = e.id === this.selfId ? this.playerName : e.name;
      presentCatch(
        {
          scene: this,
          hud: this.hud,
          hoop: this.hoop,
          who,
          mine: e.id === this.selfId,
        },
        rec ? () => this.recording.play(rec) : undefined,
      );
    });
    this.backend.on("throwRejected", (e) => {
      // the optimistic ball was cosmetic - pop it, nothing can come of it
      this.ballsByThrowId.get(e.throwId)?.consume();
      this.hud.log(
        "presence",
        e.reason === "budget"
          ? `Out of balls - your next one lands ${this.nextBallEta()}.`
          : "The court rejected that throw.",
      );
    });
    // ── the orb is a server-authoritative world object ──────────────
    this.backend.on("orbSpawned", (e) =>
      // tier 3's ambient change: "no appearance animation - it simply
      // comes into existence"
      this.teleport.orb.show(
        e.orb,
        orbTimingForTier(this.director.tierId)?.appearFx !== "none" &&
          !document.hidden,
      ),
    );
    this.backend.on("orbRemoved", (e) => {
      this.teleport.orb.removeBySeq(e.seq, e.byId !== undefined);
    });
    this.backend.on("teleported", (e) => {
      // the ball that hit the orb is spent, on every screen
      if (e.throwId) {
        this.hiddenRemoteThrows.delete(e.throwId); // consumed - never flush
        this.ballsByThrowId.get(e.throwId)?.consume();
      }
      if (e.id === this.selfId) {
        // usually we predicted this locally - then it's a no-op
        this.teleport.confirmTeleport({ x: e.x, d: e.d, h: e.h });
      } else if (document.hidden) {
        // hidden tab: snap - a queued zap would play on return
        this.remotes.get(e.id)?.avatar.setPos(e.x, e.d);
      } else {
        this.remotes.get(e.id)?.avatar.teleportTo(e.x, e.d, e.h);
      }
    });
    this.backend.on("chatMessage", (e) => {
      // YOUR messages sit right-aligned in green, like a messenger's
      // own bubbles (owner 2026-07-18) - a local class, nothing shared
      const mine = e.id === this.selfId;
      this.hud.log(
        "chat",
        `<span class="who">${this.nameHtml(e.name)}:</span> ${linkify(esc(e.text))}`,
        mine ? "mine" : undefined,
      );
      if (document.hidden) return; // the wall has it; no stale bubbles
      if (e.id === this.selfId) this.speech.say(e.text);
      else this.remotes.get(e.id)?.bubbles.say(e.text);
      playSfx(this, "sfx_chat", 0.5);
    });
    this.backend.on("worldReset", (e) => {
      this.director.applyInstant(e.world.tierId);
      this.setWorld(e.world);
      this.hud.log("world", `${this.nameHtml(e.name)} reset the court score.`);
    });
    this.backend.on("upgraded", (e) => this.onUpgraded(e));
    this.backend.on("upgradeRejected", (e) => {
      // the authority refused OUR press - say so instead of the old
      // silent nothing (the character walked up and… stood there)
      this.hud.log(
        "world",
        e.reason === "proximity"
          ? "The upgrade press missed - walk right up to the hoop."
          : "The court refused the upgrade - score below the threshold. " +
            "(Changed tiers.ts? Restart the server: tsx doesn't hot-reload.)",
      );
    });
    this.backend.on("jukebox", (e) => {
      this.jukebox?.sync(e.state);
      this.hud.log(
        "world",
        e.state
          ? `♪ ${this.nameHtml(e.byName)} spins the jukebox - ${esc(this.jukebox?.songLabel(e.state.song) ?? `song ${e.state.song + 1}`)}.`
          : `⏹ ${this.nameHtml(e.byName)} turned the jukebox off.`,
      );
    });
    this.backend.on("snapshot", (e) => {
      // self-heal: a missed upgrade event is corrected by the next snapshot
      this.director.applyInstant(e.world.tierId);
      this.setWorld(e.world);
      this.jukebox?.sync(e.world.jukebox);
      // orb self-heal is adopt-only: removal has its own ordered event,
      // and show() ignores seqs we already removed locally
      if (e.orb) this.teleport.orb.show(e.orb);
      for (const p of e.players) {
        if (p.id === this.selfId) continue;
        const r = this.remotes.get(p.id);
        if (r) {
          r.avatar.setPos(p.x, p.d);
          r.avatar.setOffline(!!p.offline); // tag self-heal
        } else this.addRemote(p); // self-heal: we somehow missed the join
      }
      for (const [id, r] of this.remotes) {
        if (!e.players.some((p) => p.id === id)) {
          r.avatar.destroy();
          this.remotes.delete(id);
        }
      }
    });

    // throw yielding: a right-click (or, on mobile, a press on the
    // character's touch ring) while cheering walks the character back
    // out of the area (PLACEHOLDER: the player re-aims once out -
    // replaying the exact aim gesture after the walk isn't possible)
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.cheer?.active) return;
      const wantsOut = isMobileDevice()
        ? playerRingHit(this, this.player, p.x, p.y)
        : p.rightButtonDown();
      if (wantsOut) this.cheer.leaveThen(() => {});
    });

    // a fetched ghost recording - play it, or admit nothing survives
    this.backend.on("recording", (e) => {
      if (e.rec && Array.isArray(e.rec.playerSamples) && e.rec.playerSamples.length) {
        this.recording.play(e.rec);
      } else {
        this.hud.log("presence", "No replay survives for that throw.");
      }
    });

    this.hud.onChat((msg) => {
      // "/..." runs a command (src/commands.ts) - never sent as chat
      if (runChatCommand(msg, { player: this.player, hud: this.hud })) return;
      this.backend.chat(msg);
    });

    // hidden-tab remote throws catch up on return: spawn each queued,
    // still-unresolved throw fast-forwarded by the time this tab was
    // away - determinism puts it exactly where live screens have it
    const flushHiddenThrows = () => {
      if (document.hidden) return;
      for (const [throwId, q] of this.hiddenRemoteThrows) {
        const elapsedS = (performance.now() - q.atMs) / 1000;
        if (elapsedS < T.ground.maxLifeS)
          this.spawnRemoteBall(throwId, q.launch, elapsedS);
      }
      this.hiddenRemoteThrows.clear();
    };
    document.addEventListener("visibilitychange", flushHiddenThrows);
    this.events.once("shutdown", () =>
      document.removeEventListener("visibilitychange", flushHiddenThrows),
    );

    // first entry (the player JUST chose a name - owner 2026-07-16: the
    // pop-up follows the name modal): the controls pop-up. The join is
    // deferred behind the ✕ - until it's pressed the character exists
    // for NOBODY: not for others (connect() is what spawns it on every
    // screen) and not on the player's own court either (rig hidden).
    // MOBILE skips it for now (owner 2026-07-17) - its mouse videos
    // teach the wrong controls; a touch tutorial is a follow-up.
    if (this.firstEntry && !isMobileDevice()) {
      this.player.setVisible(false);
      showControlsPopup(() => {
        this.player.setVisible(true);
        this.backend.connect();
      });
    } else {
      this.backend.connect();
    }
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

  /** The court reskin's splash - a sweep of bursts across the floor. */
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

  /** The tier's atmosphere: sun mood + the camera wash + the sky's own
   *  colour (tweened when it lands as a choreography beat, instant for
   *  late join/reset). A `gradual` atmosphere hands in fadeMs = the whole
   *  show's length, so the recolour rides alongside the other beats. */
  private applyAtmosphere(a: Atmosphere, animated: boolean, fadeMs?: number) {
    this.sky.setMood(a.sun);
    const o = this.atmosOverlay;
    this.tweens.killTweensOf(o);
    this.tweens.killTweensOf(this.skyFade);
    // the veil recolours the whole drawn backdrop (bands/dunes/sand);
    // the base sky means NO veil - the desert shows as painted
    const veilTarget = a.sky === BASE_ATMOSPHERE.sky ? 0 : 1;
    if (veilTarget > 0) this.backdrop.setPalette(a.sky);
    const setSky = (c: number) => {
      this.skyColor = c;
      this.cameras.main.setBackgroundColor(c);
    };
    if (!animated) {
      o.setFillStyle(a.overlay.color, a.overlay.alpha);
      setSky(a.sky);
      this.backdrop.veil = veilTarget;
      return;
    }
    // PLACEHOLDER (tune): 600 ms when the change is a beat of its own
    const dur = fadeMs ?? 600;
    o.setFillStyle(a.overlay.color, o.fillAlpha);
    this.tweens.add({
      targets: o,
      fillAlpha: a.overlay.alpha,
      duration: dur,
      ease: "Sine.easeInOut",
    });
    // the sky cross-fades from wherever it is to the tier's colour: the
    // camera colour interpolates and the backdrop veil rides the same t
    const from = Phaser.Display.Color.IntegerToColor(this.skyColor);
    const to = Phaser.Display.Color.IntegerToColor(a.sky);
    const veilFrom = this.backdrop.veil;
    this.skyFade.t = 0;
    this.tweens.add({
      targets: this.skyFade,
      t: 1,
      duration: dur,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(
          from,
          to,
          100,
          this.skyFade.t * 100,
        );
        setSky(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
        this.backdrop.veil = veilFrom + (veilTarget - veilFrom) * this.skyFade.t;
      },
    });
    if (fadeMs === undefined) {
      // a beat of its own gets the soft white blink as the light itself
      // changes; the gradual recolour starts quietly under the show
      this.cameras.main.flash(250, 255, 255, 255);
      playSfx(this, "sfx_pop", 0.7);
    }
  }

  /** The tier's ball look, everywhere at once (world, held, UI icons). */
  private applyBallLook(look: BallLookId, animated: boolean) {
    this.ballLook = look;
    // pink-purple rides a recolored TEXTURE (a multiply tint can't make
    // purple from the orange emoji); the tint composes over it
    this.ballTint = ballTintFor(look);
    const tex = ballTexture(look);
    this.player.rig.setBallTint(this.ballTint, tex);
    for (const r of this.remotes.values())
      r.avatar.rig.setBallTint(this.ballTint, tex);
    this.hud.setBallLook(look, animated);
    if (animated) playSfx(this, "sfx_pop", 0.8);
  }

  /** Track the authoritative world; the Upgrade button follows it. */
  private setWorld(w: WorldState) {
    this.world = w;
    this.upgradeBtn.setAvailable(canUpgrade(w));
    this.updateHoopScreen();
    this.rememberSeenTier();
    // the share blurb's link preview echoes the court's progress
    const req = requiredScore(w);
    this.share.setWorldProgress(
      req !== null ? Math.max(0, req - w.sharedScore) : null,
      nextTier(w.tierId)?.id ?? null,
    );
  }

  /** The hoop-foot screen: shared score / next requirement (or score
   *  alone at the top of the ladder). The requirement is the crowd-
   *  scaled threshold plus any ladder-extension base - exactly what the
   *  server will enforce (tierRules.requiredScore). */
  private updateHoopScreen() {
    this.hoop.setScoreDisplay(this.world.sharedScore, requiredScore(this.world));
  }

  /**
   * PLACEHOLDER (tune): "touching the hoop" - the press fires within
   * this distance of the hoop's base. Comfortably inside the server's
   * upgrade.proximityM so a pose-tick of telemetry lag (~0.4 m at walk
   * speed) can't lose the race.
   */
  private static readonly PRESS_DIST = 1.0;

  /**
   * The Upgrade button (at the bottom of the hoop) was clicked: the
   * errand walks the character THROUGH the keep-out zone - the only way
   * in - up to the hoop; touching it triggers the upgrade (see update()).
   * The walk is unclamped locally and the server's pose clamp opens the
   * zone while an upgrade is available, so every screen sees the march.
   */
  private tryUpgrade() {
    if (!canUpgrade(this.world)) return;
    const spot = upgradeButtonSpot();
    this.pendingUpgradePress = true;
    this.player.stop();
    this.player.walkToUnclamped(spot.x - 0.6, spot.d); // body at the pole
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
    // all active players teleported clear of the hoop - server truth,
    // applied even for an AFK player (only the SHOW is deferred)
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
    const tier = getTier(e.tierId);
    this.hud.log(
      "world",
      `${this.nameHtml(e.byName)} upgraded the court - Hoop ${e.tierId}: ${esc(tier?.name ?? "")}!`,
    );
    if (this.idle.isAfk) {
      // AFK catch-up: hold the old world; the return replays the moment
      this.director.deferUpgrade(e.tierId);
      return;
    }
    this.playUpgradeShow(e.tierId);
  }

  /** The transformation's presentation: the burst + the change list. */
  private playUpgradeShow(tierId: number | null) {
    // a burst of VFX - lots, all at once
    const { rimSX, rimSY } = this.hoop.primary;
    flash(this, rimSX, rimSY, 90);
    burst(this, rimSX, rimSY, 110);
    this.cameras.main.shake(500, 0.02);
    playSfx(this, "sfx_swish", 1);
    // the tier's ordered change list plays out as choreography
    if (tierId !== null) this.director.playUpgrade(tierId);
    else this.director.playDeferred();
    this.rememberSeenTier(); // they're watching it - it counts as seen
  }

  private addRemote(p: PlayerInfo) {
    if (this.remotes.has(p.id)) return;
    const avatar = new RemoteAvatar(this, p);
    // joiners wear the tier's look (texture + tint)
    avatar.rig.setBallTint(this.ballTint, ballTexture(this.ballLook));
    avatar.setOffline(!!p.offline); // waiting characters arrive grayed
    // an offline character standing on the deck cheers (wearily) - the
    // check reads the ACTIVE tier, so resets/upgrades are handled
    avatar.onCheerDeck = (x, d) => this.isOnCheerDeck(x, d);
    this.remotes.set(p.id, { avatar, bubbles: new SpeechBubbles(this, avatar) });
  }

  /** Is (x, d) within the cheer deck's footprint at the active tier? */
  private isOnCheerDeck(x: number, d: number): boolean {
    const deck = interactivesForTier(this.director.tierId).find(
      (el) => el.element === "cheer-area",
    );
    if (!deck) return false;
    const slack = 0.3; // clampToWalkable's grace, so the edge counts too
    return (
      Math.abs(x - deck.placement.xM) <= deck.widthM / 2 + slack &&
      Math.abs(d - deck.placement.dM) <= deck.depthM / 2 + slack
    );
  }

  /** Appear-VFX at a floor spot (character mid-height). */
  private spawnPuff(x: number, d: number) {
    if (document.hidden) return; // don't stockpile puffs for the return
    const { sx, sy } = toScreen(x, d, 0);
    puff(this, sx, sy);
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.avatar.destroy();
    this.remotes.delete(id);
  }

  /** YOUR name reads GREEN on your own wall (the messenger look, owner
   *  2026-07-18) - dim on plain lines, bright inside chat (style.css).
   *  Pure local decoration; nothing changes on the wire. */
  private nameHtml(name: string): string {
    const escd = esc(name);
    return name === this.playerName ? `<span class="me">${escd}</span>` : escd;
  }

  /** The persistent court wall: lines that happened before we joined. */
  private renderHistory(entries: HistoryEntry[]) {
    for (const h of entries) {
      // replayed lines show their RECORDED time; entries from before
      // the stamp existed show no chip (null) instead of a wrong "now"
      const at = h.atMs ?? null;
      if (h.kind === "chat") {
        this.hud.log(
          "chat",
          `<span class="who">${this.nameHtml(h.name)}:</span> ${linkify(esc(h.text))}`,
          h.name === this.playerName ? "mine" : undefined,
          undefined,
          at,
        );
      } else if (h.kind === "presence") {
        this.hud.log(
          "presence",
          `${this.nameHtml(h.name)} ${h.joined ? "joined" : "left"} the court.`,
          undefined,
          undefined,
          at,
        );
      } else if (h.kind === "reset") {
        this.hud.log(
          "world",
          `${this.nameHtml(h.name)} reset the court score.`,
          undefined,
          undefined,
          at,
        );
      } else if (h.kind === "upgrade") {
        this.hud.log(
          "world",
          `${this.nameHtml(h.name)} upgraded the court to Hoop ${h.tierId}.`,
          undefined,
          undefined,
          at,
        );
      } else if (h.kind === "catch") {
        this.hud.log(
          "throw",
          `${this.nameHtml(h.name)} caught their ball back! <span class="catch">+🏀</span>`,
          undefined,
          undefined,
          at,
        );
      } else {
        // a caught miss never was a miss - its catch entry follows
        if (!h.made && h.caught) continue;
        const d = h.distM.toFixed(1);
        const who = this.nameHtml(h.name);
        // entries that recorded a throwId replay from the stored ghost
        const throwId = h.throwId;
        this.hud.log(
          "throw",
          h.made
            ? `${who} - ${d}m ${h.slam ? "teleport slam! " : ""}${(h.rims ?? 1) >= 2 ? "DOUBLE! " : ""}${h.swish ? "SWISH! " : "hit "}<span class="pts">+${h.points}</span>`
            : h.slam
              ? `${who} - teleport slam failed!`
              : `${who} - ${d}m miss`,
          h.made ? undefined : "miss",
          throwId ? () => this.backend.requestRecording(throwId) : undefined,
          at,
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
    this.jukebox?.update(dt);
    for (const b of this.balls) b.update(dt, light);
    this.updateCatch(); // right after the balls moved, before cleanup
    this.teleport.update(dt, this.balls);
    this.recording.update(dt);

    this.balls = this.balls.filter((b) => !b.done);
    this.rig.update(dt);
    this.idle.update();

    // the tier-4 carriage rides the shared clock - every screen (and
    // the server's resolver) reads the same seeded timeline
    if (this.hoopMotionVisible) this.hoop.setLift(this.currentLift());

    // the atmosphere wash always covers exactly what the camera sees
    // (scroll AND zoom - a scrollFactor-0 rect would break under zoom)
    const wv = this.cameras.main.worldView;
    this.atmosOverlay.setPosition(wv.x, wv.y).setSize(wv.width, wv.height);

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
      // the server would reject it and nobody else would see it - don't
      // fake a flight that doesn't exist for the rest of the court
      this.hud.log(
        "presence",
        `Out of balls - your next one lands ${this.nextBallEta()}.`,
      );
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
      // the moving hoop's timeline anchor - our flight and the server's
      // resolution read the hoop from this same instant
      atMs: Date.now(),
    };
    // random suffix: throwIds must not collide ACROSS clients - everyone
    // sees everyone's ids (outcomes, orb-consumed balls)
    const throwId = `t${++this.throwSeq}-${Math.random().toString(36).slice(2, 8)}`;
    this.backend.requestThrow(throwId, launch);
    // follow-through sweep along the real launch direction
    this.player.startThrow(Math.atan2(shot.vh, shot.vx), shot.power);
    // the levitation throw is the last act up there - falling starts now
    this.teleport.onThrowReleased();
  }

  /** A confirmed throw: spawn the live feel-simulation ball + recorder. */
  private spawnBall(throwId: string, launch: ThrowLaunch) {
    // a throw made with a caught ball can't be caught again (the
    // authority tracks the same credit - see backend catchBall)
    const bornFromCatch = this.catchCredits > 0;
    if (bornFromCatch) this.catchCredits--;
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
      geom: this.flightGeom(launch),
      // YOUR ball reads slightly different from everyone else's (you can
      // only catch your own) - composed over the tier's look
      tint: multiplyTint(this.ballTint, T.ownBallMarker),
      texture: ballTexture(this.ballLook),
      onScore: (o) => {
        this.recording.stampOutcome(rec, true);
        this.backend.reportOutcome(throwId, {
          made: true,
          swish: o.swish,
          slam: launch.slam,
          rims: o.rims,
          rimIds: o.rimIds,
          distM: o.distM,
        });
      },
      onMiss: (o) => {
        this.recording.stampOutcome(rec, false);
        const ot = this.ownThrows.get(throwId);
        if (ot) ot.missed = true; // the catch window opens
        this.backend.reportOutcome(throwId, {
          made: false,
          swish: false,
          slam: launch.slam,
          rims: 0,
          rimIds: [],
          distM: o.distM,
        });
      },
      onDone: () => {
        this.ballsByThrowId.delete(throwId);
        // the ball is gone - a held miss can't become a catch anymore
        this.flushPendingMiss(throwId);
      },
      onRimScore: (rimId, distM) => this.rimScoreJuice(rimId, distM),
    });
    rec = this.recording.beginThrow(
      ball,
      launch.slam,
      this.playerName,
      this.director.ballLook, // the recolour rule stamps record time
      throwId,
      this.director.tierId, // ...and so does the hoop tier (ghost hoop)
      this.world.hoopMotion, // ...and the moving hoop's schedule
    );
    this.recsByThrowId.set(throwId, rec);
    this.ballsByThrowId.set(throwId, ball);
    this.ownThrows.set(throwId, {
      ball,
      rec,
      missed: false,
      bornFromCatch,
      caught: false,
    });
    this.balls.push(ball);
  }

  /** A remote player's throw - animate it from the launch params. */
  /** fastForwardS > 0 = the hidden-tab catch-up: pre-simulate that many
   *  seconds and spawn the ball mid-flight (silently - no pop, no sfx). */
  private spawnRemoteBall(throwId: string, launch: ThrowLaunch, fastForwardS = 0) {
    let resume: { state: BallState; lifeS: number } | undefined;
    if (fastForwardS > 0) {
      const ff = fastForwardBall(
        launch.x,
        launch.d,
        launch.h,
        launch.vx,
        launch.vh,
        fastForwardS,
        this.flightGeom(launch),
      );
      if (ff.rested) return; // already came to rest - nothing left to show
      resume = { state: ff.s, lifeS: fastForwardS };
    }
    const ball = new Ball(this, {
      x: launch.x,
      d: launch.d,
      h: launch.h,
      vx: launch.vx,
      vh: launch.vh,
      shotDistM: floorDistToRim(launch.shotX, launch.shotD),
      own: false, // never triggers OUR power-ups; the server rules theirs
      geom: this.flightGeom(launch),
      tint: this.ballTint,
      texture: ballTexture(this.ballLook),
      // cosmetic: the server's outcome event carries the result
      onScore: () => {},
      onMiss: () => {},
      onDone: () => {
        this.ballsByThrowId.delete(throwId);
        // their ball is gone here and no catch arrived - the miss stands
        this.flushPendingMiss(throwId);
      },
      // spectators see the upper-rim hit the moment it happens too
      onRimScore: (rimId, distM) => this.rimScoreJuice(rimId, distM),
      resume,
    });
    this.ballsByThrowId.set(throwId, ball);
    this.balls.push(ball);
  }

  /**
   * A rim registered MID-FLIGHT without resolving the throw - the upper
   * of the double hoop. Juice THAT rim right now so the hit visibly
   * counts (owner 2026-07-17: "the upper rim doesn't register" - it
   * did, silently; the score only showed at the LOWER rim's resolution
   * half a second later). The outcome still carries the real points -
   * this preview uses the same per-rim table the authority sums.
   */
  private rimScoreJuice(rimId: string, shotDistM: number) {
    if (document.hidden) return; // log-only tabs skip stale juice
    const rim = this.hoop.rims.find((r) => r.id === rimId) ?? this.hoop.primary;
    netSnap(this, rim.net);
    flash(this, rim.rimSX, rim.rimSY, 30);
    floatText(
      this,
      rim.rimSX,
      rim.rimSY - 26,
      `${rimId === "upper" ? "UPPER HOOP!" : "SCORE!"} +${rimPoints(shotDistM, this.director.tierId, rimId)}`,
      "#ffb84d",
      20,
    );
    playSfx(this, "sfx_score", 0.8);
  }

  // ── catch the ball (owner ask 2026-07-16): an OWN missed ball landing
  //    within the player's footprint (+10%) comes back - once per ball ──

  /** Per-frame: any of our missed balls landing at our feet? */
  private updateCatch() {
    for (const [throwId, o] of this.ownThrows) {
      if (o.ball.done) {
        this.ownThrows.delete(throwId); // bookkeeping follows the ball
        continue;
      }
      if (!o.missed || o.caught || o.bornFromCatch) continue;
      const p = o.ball.pos;
      const c = T.catchFeel;
      if (
        p.h <= c.landHM &&
        Math.abs(p.x - this.player.x) <= c.halfXM &&
        Math.abs(p.d - this.player.d) <= c.halfDM
      )
        this.doCatch(throwId, o);
    }
  }

  /** The ball is at our feet: take it back (optimistically - the
   *  authority validates and refunds; see Backend.catchBall). */
  private doCatch(throwId: string, o: OwnThrow) {
    o.caught = true;
    this.catchCredits++; // the returned ball can never be caught again
    this.dropPendingMiss(throwId); // it never was a miss
    this.backend.catchBall(throwId);
    this.recording.stampCatch(o.rec); // the replay pops the ball here
    o.ball.consume();
    announceText(this, "CATCH! +🏀", "#6ac48a");
  }

  /** An authoritative budget landed: adopt count + regen deadline, feed
   *  the HUD (with the AFK pop baseline on the very first one). */
  private applyBudget(n: number, nextBallInS: number | null) {
    this.throwsRemaining = n;
    this.regenDeadlineMs =
      nextBallInS === null ? null : Date.now() + nextBallInS * 1000;
    let popFrom: number | undefined;
    if (!this.budgetSeenOnce) {
      this.budgetSeenOnce = true;
      // the last count this browser SAW here - balls earned while away
      // pop in staggered, even across a closed tab
      const seen = Number(localStorage.getItem(this.ballsSeenKey()));
      if (Number.isFinite(seen)) popFrom = Math.max(0, Math.min(seen, n));
    }
    this.rememberBallsSeen(n);
    this.hud.setBudget(n, this.regenDeadlineMs, popFrom);
  }

  private ballsSeenKey(): string {
    return `shootDaHoop.ballsSeen.${this.lobby ?? "offline"}`;
  }

  private rememberBallsSeen(n: number) {
    localStorage.setItem(this.ballsSeenKey(), String(n));
  }

  /** "in 7m 12s" - the wait for the next ball, for the out-of-balls logs. */
  private nextBallEta(): string {
    if (this.regenDeadlineMs === null) return "soon";
    const s = Math.max(0, Math.ceil((this.regenDeadlineMs - Date.now()) / 1000));
    return `in ${Math.floor(s / 60)}m ${s % 60}s`;
  }

  /** The authoritative result came back - score display + juice + log. */
  private presentOutcome(e: ThrowOutcome) {
    // resolved before the viewer came back: log-only, never flush a
    // catch-up ball for it (structurally prevents double-presentation)
    this.hiddenRemoteThrows.delete(e.throwId);
    this.setWorld(e.world);
    const own = e.playerId === this.selfId;
    // caught locally before the outcome even landed - the caught event
    // (right behind it) logs the catch; the miss never existed
    if (own && this.ownThrows.get(e.throwId)?.caught) return;
    const who = own
      ? this.playerName
      : (this.remotes.get(e.playerId)?.avatar.name ?? "Someone");
    const ctx = { scene: this, hud: this.hud, hoop: this.hoop, who, mine: own };
    // rimIds don't ride the wire outcome - display code never prices rims
    const o = {
      made: e.made,
      swish: e.swish,
      rims: e.rims,
      rimIds: [],
      distM: e.distM,
    };
    if (e.made) {
      // the share roll tracks OWN hits only (share v5) - the first one
      // of the share-day is what reveals the button
      if (own) this.share.noteResult(true, e.points);
      // own throws replay from the local recording (instant); remote
      // ones fetch the thrower's stored ghost from the authority
      const rec = own ? this.recsByThrowId.get(e.throwId) : undefined;
      this.recsByThrowId.delete(e.throwId);
      const onReplay = rec
        ? () => this.recording.play(rec)
        : () => this.backend.requestRecording(e.throwId);
      // hidden tab → log-only: no stale juice bursting on return
      presentScore(ctx, o, e.points, e.slam, onReplay, document.hidden);
      return;
    }
    // A MISS - but while the ball still bounces the thrower may CATCH it
    // (then it never was a miss, in the log or the share roll). Hold the
    // line back until the ball is done (onDone flush), a catch arrives
    // (drop), or a DOM timeout fires - Phaser pauses on hidden tabs and
    // a held miss must not survive forever.
    const present = () => {
      const rec = own ? this.recsByThrowId.get(e.throwId) : undefined;
      this.recsByThrowId.delete(e.throwId);
      presentMiss(
        ctx,
        o,
        e.slam,
        rec
          ? () => this.recording.play(rec)
          : () => this.backend.requestRecording(e.throwId),
      );
    };
    const ball = this.ballsByThrowId.get(e.throwId);
    if (ball && !ball.done) {
      const timeoutId = window.setTimeout(
        () => this.flushPendingMiss(e.throwId),
        (T.ground.maxLifeS + 2) * 1000,
      );
      this.pendingMisses.set(e.throwId, { present, timeoutId });
    } else present(); // no live ball on this screen - nothing to wait for
  }

  /** The held miss stands (ball gone, nobody caught it) - log it now. */
  private flushPendingMiss(throwId: string) {
    const p = this.pendingMisses.get(throwId);
    if (!p) return;
    clearTimeout(p.timeoutId);
    this.pendingMisses.delete(throwId);
    p.present();
  }

  /** The held miss never happened (the ball was caught) - discard it. */
  private dropPendingMiss(throwId: string) {
    const p = this.pendingMisses.get(throwId);
    if (!p) return;
    clearTimeout(p.timeoutId);
    this.pendingMisses.delete(throwId);
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
