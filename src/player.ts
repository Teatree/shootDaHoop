import Phaser from "phaser";
import { T } from "./tuning";
import { FREE_THROW_X, RIM, clampToCourt, floorY, sortDepth, toScreen } from "./world";
import { shadowShift, type LightDir } from "./sky";
import { CharacterRig, type RigLook } from "./characterRig";
import { bodyAim, FIGURE_H, type PoseState } from "./shared/pose";
import type { AvatarState } from "./shared/messages";

/** the throw follow-through sweep, seconds */
const THROW_ANIM_S = 0.15;

export class Player {
  // court position, meters — spawn at the free-throw spot, but never
  // inside the hoop's keep-out zone
  x = clampToCourt(FREE_THROW_X, RIM.d).x;
  d = RIM.d;
  /** Feet height above the floor — non-zero while teleport-levitating/falling. */
  airH = 0;
  /** What the player may do: walking needs "full", aiming needs ≥ "throwOnly". */
  control: "full" | "throwOnly" | "none" = "full";

  aiming = false;
  /** live aim readout (AimController writes it) — null in the deadzone */
  aimInfo: { angle: number; power: number } | null = null;
  /** the teleport system's override while airborne/floored */
  tpKind: "fall" | "lie" | null = null;
  /** a scripted activity's pose (the cheer area) — beats normal kinds */
  poseOverride: "cheer" | null = null;

  /** the visible body — teleport tweens target rig.angle */
  readonly rig: CharacterRig;

  private walking = false;
  private targetX = 0;
  private targetD = 0;
  private bobT = 0;
  private facingRight = true;
  private light: LightDir = { dx: 0, elev: 1 }; // neutral until the sky reports
  /** seconds since the current fall/throw began (pose clocks) */
  private stateT = 0;
  private lastKind: PoseState["kind"] = "idle";
  private throwT = Infinity; // < THROW_ANIM_S while the sweep plays
  private throwAim = { angle: 0.9, power: 0.5 };

  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, name: string, look: RigLook) {
    // PLACEHOLDER (tune): widened 44 → 54, our guys are more fat now
    this.shadow = scene.add.ellipse(0, 0, 54, 9, 0x000000, 0.22);
    this.rig = new CharacterRig(scene, look);
    this.label = scene.add
      .text(0, 0, name, {
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: "13px",
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#20303a",
        strokeThickness: 3, // dark outline — readable against sky and court
      })
      .setOrigin(0.5, 1)
      .setResolution(2); // keep the small text legible under pixelArt
    this.rig.applyPose({ kind: "idle", t: 0 }, 1);
    this.render();
  }

  /** Left-click: set an (x, d) floor destination. Ignored while aiming. */
  walkTo(x: number, d: number) {
    if (this.aiming || this.control !== "full") return;
    const c = clampToCourt(x, d);
    this.targetX = c.x;
    this.targetD = c.d;
    this.walking = true;
    if (Math.abs(c.x - this.x) > 0.01) this.facingRight = c.x >= this.x;
  }

  stop() {
    this.walking = false;
  }

  /**
   * Scripted errands (the Upgrade press walking THROUGH the keep-out
   * zone to the hoop) go exactly where they're told — no court clamp.
   * User clicks still route through walkTo.
   */
  walkToUnclamped(x: number, d: number) {
    this.targetX = x;
    this.targetD = d;
    this.walking = true;
    if (Math.abs(x - this.x) > 0.01) this.facingRight = x >= this.x;
  }

  /** Right-click pressed: plant into the shooting stance immediately. */
  enterStance() {
    this.stop();
    this.aiming = true;
    this.facingRight = true; // square up to the hoop until the aim says otherwise
  }

  exitStance() {
    this.aiming = false;
    this.aimInfo = null;
  }

  /** The ball just left the hands — play the follow-through sweep. */
  startThrow(angle: number, power: number) {
    // backwards throws turn the whole character around (world → body space)
    const a = bodyAim(angle);
    this.facingRight = a.facing === 1;
    this.throwAim = { angle: a.aimAngle, power };
    this.throwT = 0;
  }

  /** The pose the world should see this frame — also what gets streamed. */
  poseState(): PoseState {
    const kind = this.currentKind();
    if (kind !== this.lastKind) {
      this.lastKind = kind;
      this.stateT = 0;
    }
    switch (kind) {
      case "walk":
        return { kind, t: this.bobT };
      case "aim": {
        // body-relative angle: the facing flip carries the direction,
        // so streams/recordings replay the turn on every screen
        const a = this.aimInfo ? bodyAim(this.aimInfo.angle) : null;
        return {
          kind,
          t: 0,
          aimAngle: a?.aimAngle,
          aimPower: this.aimInfo?.power ?? 0,
        };
      }
      case "throw":
        return {
          kind,
          t: this.throwT / THROW_ANIM_S,
          aimAngle: this.throwAim.angle,
          aimPower: this.throwAim.power,
        };
      case "fall":
      case "cheer":
        return { kind, t: this.stateT }; // drives the waggle / pump rhythm
      default:
        // idle/lie/getup are static — a constant clock keeps the
        // telemetry dirty-check quiet while standing around
        return { kind, t: 0 };
    }
  }

  /** Everything a ghost recording or the pose stream needs. */
  visualState(): AvatarState {
    return {
      x: this.x,
      d: this.d,
      airH: this.airH,
      facing: this.facingRight ? 1 : -1,
      angle: this.rig.angle,
      pose: this.poseState(),
    };
  }

  /** Where the ball leaves the hands. */
  releasePoint() {
    return {
      x: this.x + T.throw.releaseForwardM,
      d: this.d,
      h: this.airH + T.throw.releaseHeightM,
    };
  }

  update(dt: number, light?: LightDir) {
    if (light) this.light = light;
    this.stateT += dt;
    this.throwT += dt;
    // aiming backwards spins the character to face the aim direction
    if (this.aiming && this.aimInfo)
      this.facingRight = bodyAim(this.aimInfo.angle).facing === 1;
    if (this.walking && !this.aiming) {
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
      }
    }
    this.rig.setFacing(this.facingRight);
    this.rig.applyPose(this.poseState(), dt);
    this.render();
  }

  private currentKind(): PoseState["kind"] {
    if (this.tpKind) return this.tpKind; //         fall / lie
    if (this.poseOverride) return this.poseOverride; // cheering
    if (Math.abs(this.rig.angle) > 0.5) return "getup"; // standing back up
    if (this.throwT < THROW_ANIM_S) return "throw";
    if (this.aiming) return "aim";
    if (this.walking) return "walk";
    return "idle";
  }

  private render() {
    const { sx, sy } = toScreen(this.x, this.d, this.airH);
    this.rig.setPosition(sx, sy);
    this.rig.setDepth(sortDepth(this.d));
    this.label.setPosition(sx, sy - FIGURE_H - 9);
    this.label.setDepth(sortDepth(this.d) + 1);
    // drop shadow leans away from the dominant sun (caster ≈ body midpoint,
    // higher while levitating); shrinks and fades with altitude like the ball
    const li = this.light;
    const hFrac = Phaser.Math.Clamp(1 - this.airH / 6, 0.25, 1);
    // face-planted bodies lie forward of their feet: slide the shadow
    // under them, scaled by how far the rig has rotated so the teleport
    // tween (angle 0↔90) drives the transition smoothly both ways.
    // PLACEHOLDER (tune): 10 px down + right when fully down.
    const down = Math.min(1, Math.abs(this.rig.angle) / 90);
    this.shadow.setPosition(
      sx + shadowShift(1.0 + this.airH, li) + 10 * down,
      floorY(this.d) + 10 * down,
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
