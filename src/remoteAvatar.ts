import Phaser from "phaser";
import { T } from "./tuning";
import { clampToCourt, floorY, sortDepth, toScreen } from "./world";
import { burst, flash } from "./juice";
import { playSfx } from "./sfx";
import { shadowShift, type LightDir } from "./sky";
import { CharacterRig } from "./characterRig";
import { FIGURE_H, lerpPoseState, type PoseState } from "./shared/pose";
import { sampleAt } from "./ghostData";
import type { AvatarState, PlayerInfo } from "./shared/messages";

// Another player's character. Two sources of truth, best first:
//
//  1. POSE TELEMETRY — ~12 Hz AvatarState samples. We render ~150 ms in
//     the past and lerp between the two samples straddling that moment,
//     so motion (and the telegraphed aim) is smooth, never jerky.
//  2. FALLBACK SIM — if the stream goes stale (drops, an old server),
//     the original move-to intent walk + teleport state machine take
//     over, exactly the pre-telemetry behaviour.
//
// Teleport events still fire the zap VFX/SFX in both modes; the pose
// stream carries the levitate/fall/lie choreography itself.

const ZAP = [0x2e7bff, 0x9fd0ff, 0xffffff] as const;

/** render this far behind the newest sample — one lost packet's slack */
const LERP_DELAY_S = 0.15;
/** no samples for this long → the intent-walk fallback drives */
const STALE_S = 0.7;

interface TimedState {
  t: number;
  s: AvatarState;
}

const lerpTimed = (a: TimedState, b: TimedState, f: number): TimedState => {
  const lin = (x: number, y: number) => x + (y - x) * f;
  const near = f < 0.5 ? a : b;
  return {
    t: 0,
    s: {
      x: lin(a.s.x, b.s.x),
      d: lin(a.s.d, b.s.d),
      airH: lin(a.s.airH, b.s.airH),
      facing: near.s.facing,
      angle: lin(a.s.angle, b.s.angle),
      pose: lerpPoseState(a.s.pose, b.s.pose, f),
    },
  };
};

export class RemoteAvatar {
  x: number;
  d: number;
  /** feet height above the floor — non-zero through a teleport arc */
  airH = 0;

  readonly name: string;

  /** face-plant rotation for the FALLBACK machine's tweens */
  readonly rig: CharacterRig;

  private clock = 0;
  private buffer: TimedState[] = [];

  // ── fallback sim state (the pre-telemetry behaviour) ──────────────
  private walking = false;
  private targetX = 0;
  private targetD = 0;
  private bobT = 0;
  private facingRight = true;
  private light: LightDir = { dx: 0, elev: 1 };
  private tpState: "none" | "levitate" | "fall" | "down" = "none";
  private tpTimer = 0;
  private returnD = 0; // depth row to fall back onto
  private fallV = 0;

  private readonly label: Phaser.GameObjects.Text;
  private readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(
    private readonly scene: Phaser.Scene,
    info: PlayerInfo,
  ) {
    this.x = info.x;
    this.d = info.d;
    this.name = info.name;
    this.shadow = scene.add.ellipse(0, 0, 44, 9, 0x000000, 0.22);
    this.rig = new CharacterRig(scene, info);
    this.label = scene.add
      .text(0, 0, info.name, {
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: "11px",
        fontStyle: "bold",
        color: "#6ac48a",
      })
      .setOrigin(0.5, 1)
      .setAlpha(0.65)
      .setResolution(2);
    this.render(null);
  }

  /** A ~12 Hz telemetry sample — the primary animation source. */
  pushSample(s: AvatarState) {
    this.buffer.push({ t: this.clock, s });
    // keep a couple of seconds; sampleAt scans linearly
    const cutoff = this.clock - 2;
    while (this.buffer.length && this.buffer[0].t < cutoff)
      this.buffer.shift();
  }

  /** A broadcast movement intent — fallback path (and stale recovery). */
  walkTo(x: number, d: number) {
    if (this.tpState !== "none") return; // mid-teleport: no walking
    const c = clampToCourt(x, d);
    this.targetX = c.x;
    this.targetD = c.d;
    this.walking = true;
    if (Math.abs(c.x - this.x) > 0.01) this.facingRight = c.x >= this.x;
  }

  /** Snapshot reconciliation — snap without walking. */
  setPos(x: number, d: number) {
    if (this.streamFresh()) return; // the stream is truth while it flows
    if (this.walking || this.tpState !== "none") return;
    this.x = x;
    this.d = d;
  }

  /** The server ruled their ball hit the orb — zap VFX + fallback state. */
  teleportTo(x: number, d: number, h: number) {
    // zapp out…
    const fs = toScreen(this.x, this.d, this.airH + 1);
    flash(this.scene, fs.sx, fs.sy, 30);
    burst(this.scene, fs.sx, fs.sy, 24, ZAP, 260);

    this.walking = false;
    this.returnD = this.d;
    this.x = x;
    this.d = d;
    this.airH = h;
    this.tpState = "levitate";
    // their throw usually ends the levitation (onThrowReleased); the extra
    // second absorbs network delay before we force the fall ourselves
    this.tpTimer = T.orb.levitateS + 1.0;

    // …zapp in
    const ts = toScreen(x, d, h + 1);
    flash(this.scene, ts.sx, ts.sy, 44);
    burst(this.scene, ts.sx, ts.sy, 36, ZAP, 300);
    playSfx(this.scene, "sfx_pop", 0.8);
  }

  /** Their levitation throw arrived — falling starts now, like ours. */
  onThrowReleased() {
    if (this.tpState === "levitate") this.startFall();
  }

  update(dt: number, light?: LightDir) {
    if (light) this.light = light;
    this.clock += dt;

    if (this.streamFresh()) {
      const at = sampleAt(this.buffer, this.clock - LERP_DELAY_S, lerpTimed);
      const s = at?.s ?? this.buffer[this.buffer.length - 1].s;
      this.x = s.x;
      this.d = s.d;
      this.airH = s.airH;
      this.facingRight = s.facing === 1;
      this.rig.angle = s.angle;
      this.render(s.pose, dt);
      return;
    }

    this.updateFallback(dt);
  }

  destroy() {
    this.rig.destroy();
    this.label.destroy();
    this.shadow.destroy();
  }

  private streamFresh(): boolean {
    const last = this.buffer[this.buffer.length - 1];
    return last !== undefined && this.clock - last.t < STALE_S;
  }

  // ── the original intent-walk + teleport machine ────────────────────

  private updateFallback(dt: number) {
    let pose: PoseState = { kind: "idle", t: 0 };
    if (this.tpState === "levitate") {
      this.airH -= T.tp.sinkSpeedM * dt;
      this.tpTimer -= dt;
      if (this.tpTimer <= 0) this.startFall();
    } else if (this.tpState === "fall") {
      this.fallV += T.throw.gravityM * dt;
      this.airH -= this.fallV * dt;
      this.d += (this.returnD - this.d) * Math.min(1, 4 * dt);
      pose = { kind: "fall", t: this.tpTimer };
      if (this.airH <= 0) {
        this.airH = 0;
        this.d = this.returnD;
        this.tpState = "down";
        this.tpTimer = T.tp.lieS;
        playSfx(this.scene, "sfx_bounce", 0.6);
        this.scene.tweens.add({
          targets: this.rig,
          angle: 90,
          duration: 240,
          ease: "Quad.easeIn",
        });
      }
    } else if (this.tpState === "down") {
      this.tpTimer -= dt;
      pose = { kind: "lie", t: 0 };
      if (this.tpTimer <= 0) {
        this.tpState = "none";
        this.scene.tweens.add({
          targets: this.rig,
          angle: 0,
          duration: T.tp.getUpMs,
          ease: "Back.easeOut",
        });
      }
    } else if (this.walking) {
      const dx = this.targetX - this.x;
      const dd = this.targetD - this.d;
      const dist = Math.hypot(dx, dd);
      if (dist <= T.move.arriveEps) {
        this.walking = false;
      } else {
        const step = Math.min(dist, T.move.speedM * dt);
        this.x += (dx / dist) * step;
        this.d += (dd / dist) * step;
        this.bobT += dt;
        pose = { kind: "walk", t: this.bobT };
      }
    }
    if (this.tpState === "fall") this.tpTimer += dt; // fall clock for waggle
    if (this.tpState === "none" && Math.abs(this.rig.angle) > 0.5)
      pose = { kind: "getup", t: 0 };
    this.render(pose, dt);
  }

  private startFall() {
    this.tpState = "fall";
    this.tpTimer = 0;
    this.fallV = 0;
  }

  private render(pose: PoseState | null, dt = 1) {
    const { sx, sy } = toScreen(this.x, this.d, this.airH);
    this.rig.setFacing(this.facingRight);
    if (pose) this.rig.applyPose(pose, dt);
    this.rig.setPosition(sx, sy);
    this.rig.setDepth(sortDepth(this.d));
    this.label.setPosition(sx, sy - FIGURE_H - 9);
    this.label.setDepth(sortDepth(this.d) + 1);
    // shadow shrinks/fades with height and leans away from the sun,
    // exactly like Player's
    const li = this.light;
    const hFrac = Phaser.Math.Clamp(1 - this.airH / 6, 0.25, 1);
    this.shadow.setPosition(
      sx + shadowShift(1.0 + this.airH, li),
      floorY(this.d),
    );
    this.shadow.setScale(
      hFrac * (1 + (T.sky.shadowStretchMax - 1) * (1 - li.elev)),
      hFrac,
    );
    this.shadow.fillAlpha =
      Phaser.Math.Linear(T.sky.shadowAlphaLow, T.sky.shadowAlphaHigh, li.elev) *
      hFrac;
    this.shadow.setDepth(sortDepth(this.d) - 1);
  }
}
