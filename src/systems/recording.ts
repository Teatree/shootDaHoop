import Phaser from "phaser";
import { T } from "../tuning";
import { GhostPlayback } from "../ghost";
import type { FrameSample, ThrowRecording } from "../ghostData";
import type { Player } from "../player";
import type { TeleportOrb } from "../powerup";
import type { SpeechBubbles } from "../speech";
import type { Ball } from "../ball";
import type { RigLook } from "../characterRig";
import type { BallLookId } from "../shared/tierChanges";

// Ghost records, capture side: a rolling buffer of world frame samples
// (player + orb + speech bubble), one recorder per live throw, and the
// playback engine. CourtScene begins a recording per throw and stamps the
// outcome; everything else is ticked here.

interface Xyz {
  x: number;
  d: number;
  h: number;
}

interface ActiveRecorder {
  rec: ThrowRecording;
  ball: Ball;
  t0: number;
}

export interface RecordingProviders {
  player: Player;
  orb: TeleportOrb;
  speech: SpeechBubbles;
}

export class RecordingSystem {
  readonly playback: GhostPlayback;
  /** finished + in-flight recordings, oldest first (bounded, see evict) */
  readonly store: ThrowRecording[] = [];

  private timeS = 0;
  private history: FrameSample[] = [];
  private active: ActiveRecorder[] = [];
  private lastTeleport?: { at: number; from: Xyz; to: Xyz };

  constructor(
    scene: Phaser.Scene,
    private readonly providers: RecordingProviders,
    private readonly look: RigLook,
    onMade: () => void,
    /** a recording just finalized - the scene ships it to the backend
     *  so the wall line replays on every screen, forever */
    private readonly onFinished?: (rec: ThrowRecording) => void,
  ) {
    this.playback = new GhostPlayback(scene, look, onMade);
  }

  /** Anchors the next slam recording and lets it replay the zapp. */
  noteTeleport(from: Xyz, to: Xyz) {
    this.lastTeleport = { at: this.timeS, from, to };
  }

  /**
   * Start recording a throw. Pre-roll comes from the rolling history;
   * slams rewind to before the orb hit so the observer sees the whole
   * power-up play.
   */
  beginThrow(
    ball: Ball,
    isSlam: boolean,
    name: string,
    ballLook: BallLookId = "classic",
    throwId?: string,
  ): ThrowRecording {
    const tp = isSlam ? this.lastTeleport : undefined;
    const t0 = tp ? tp.at - T.ghost.slamPreRollS : this.timeS - T.ghost.preRollS;
    const rec: ThrowRecording = {
      name,
      throwId, // the persistence key (server-stored replays)
      // the thrower's look rides along so a replay fetched by ANOTHER
      // player dresses the ghost right
      look: {
        shirtColor: this.look.shirtColor,
        skinTint: this.look.skinTint,
        lowerTint: this.look.lowerTint,
        headVariant: this.look.headVariant,
      },
      ballLook, // stamped NOW - the replay recolour rule reads this
      playerSamples: this.history
        .filter((s) => s.t >= t0)
        .map((s) => ({ ...s, t: s.t - t0 })),
      ballSamples: [],
      teleportT: tp ? tp.at - t0 : undefined,
      teleportFrom: tp?.from,
      teleportTo: tp?.to,
      done: false,
      evicted: false,
    };

    this.store.push(rec);
    if (this.store.length > T.ghost.maxStored) {
      const old = this.store.shift()!;
      old.evicted = true; // free the memory; its log line goes inert
      old.playerSamples = [];
      old.ballSamples = [];
    }

    this.active.push({ rec, ball, t0 });
    return rec;
  }

  /** The throw resolved - mark when and how, so the replay knows. */
  stampOutcome(rec: ThrowRecording, made: boolean) {
    const ar = this.active.find((a) => a.rec === rec);
    if (!ar) return;
    rec.outcomeT = this.timeS - ar.t0;
    rec.made = made;
  }

  /** The thrower caught the missed ball back - the replay pops it there. */
  stampCatch(rec: ThrowRecording) {
    const ar = this.active.find((a) => a.rec === rec);
    if (!ar) return;
    rec.catchT = this.timeS - ar.t0;
  }

  play(rec: ThrowRecording) {
    this.playback.play(rec);
  }

  /** Sample this frame into the rolling history and every live recorder. */
  update(dt: number) {
    this.timeS += dt;
    const frame: Omit<FrameSample, "t"> = {
      ...this.providers.player.visualState(),
      orb: this.providers.orb.sample(),
      bubble: this.providers.speech.current(),
    };
    this.history.push({ t: this.timeS, ...frame });
    // slam recordings rewind to slamPreRollS before the ORB HIT, which can
    // itself be a full levitation before the throw - keep enough history
    const keepFrom = this.timeS - (T.ghost.slamPreRollS + T.orb.levitateS + 1);
    while (this.history.length && this.history[0].t < keepFrom)
      this.history.shift();

    for (let i = this.active.length - 1; i >= 0; i--) {
      const ar = this.active[i];
      const rt = this.timeS - ar.t0;
      ar.rec.playerSamples.push({ t: rt, ...frame });
      if (!ar.ball.done) {
        const p = ar.ball.pos;
        ar.rec.ballSamples.push({ t: rt, x: p.x, d: p.d, h: p.h });
      }
      if (
        ar.rec.outcomeT !== undefined &&
        rt >= ar.rec.outcomeT + T.ghost.postRollS &&
        // a missed ball may still be CAUGHT while it bounces - keep
        // recording until it pops, so the catch moment always lands
        (ar.rec.made || ar.ball.done)
      ) {
        ar.rec.done = true;
        // misses can outlive the post-roll; hold a beat past the pop
        ar.rec.duration = Math.max(ar.rec.outcomeT + T.ghost.postRollS, rt + 0.5);
        this.active.splice(i, 1);
        this.onFinished?.(ar.rec); // complete (incl. any catch) - ship it
      } else if (ar.ball.done && ar.rec.outcomeT === undefined) {
        // ball was consumed (power-up) - no log line, nothing to replay
        this.active.splice(i, 1);
      }
    }

    this.playback.update(dt);
  }
}
