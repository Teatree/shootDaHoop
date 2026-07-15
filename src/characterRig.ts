import Phaser from "phaser";
import { T } from "./tuning";
import { M } from "./world";
import {
  computePose,
  idlePose,
  ITCH_DURATION_S,
  PART_ANCHORS,
  rollIdleTraits,
  rollItchDelayS,
  type PoseState,
  type RigPose,
  type V2,
} from "./shared/pose";
import { partTexture } from "./placeholders";

// The parts character: five images in one container (draw order matches
// the art's layer plan - left hand BEHIND the body, right hand in front)
// plus a held ball that appears while aiming. All animation is positional
// offsets from shared/pose.ts; the rig's job is Phaser plumbing:
//   - tint once at creation (skin shared by head+hands, shirt hard,
//     trousers subtle) - no per-colour textures, any colour works
//   - mirror the whole figure for facing (scaleX = ±1)
//   - exponentially smooth every part toward its pose target, so kind
//     changes (idle→aim, fall→idle…) ease instead of snapping - this is
//     also what makes 12 Hz remote telemetry look continuous
//
// External rotation (the face-plant tween) targets `rig.angle`; the pose's
// own tilt is added on top each frame, so the two never fight.

export interface RigLook {
  shirtColor: number;
  skinTint: number;
  lowerTint: number;
  headVariant: number;
}

/** how fast parts chase their pose targets (1/s) - higher = snappier */
const SMOOTH_RATE = 18;

type PartName = keyof typeof PART_ANCHORS;
const DRAW_ORDER: PartName[] = ["handL", "lower", "upper", "head", "handR"];

export class CharacterRig {
  readonly container: Phaser.GameObjects.Container;
  /** face-plant rotation, degrees - tweens target this plain property */
  angle = 0;

  private readonly parts: Record<PartName, Phaser.GameObjects.Image>;
  private readonly heldBall: Phaser.GameObjects.Image;
  private facingRight = true;
  /** smoothed current pose (starts at idle) */
  private cur: RigPose = computePose({ kind: "idle", t: 0 });
  private curTilt = 0;

  // ── idle life (local-only, never streamed): every character breathes
  // at its own rolled rate and scratches its belly once in a while ────
  private readonly idleTraits = rollIdleTraits();
  /** random start phase - a crowd must not inhale in unison */
  private idleT = Math.random() * 10;
  private nextItchAt = this.idleT + rollItchDelayS();

  constructor(scene: Phaser.Scene, look: RigLook) {
    const img = (key: string) => scene.add.image(0, 0, partTexture(scene, key));

    this.parts = {
      head: img(`head_v${look.headVariant}`),
      lower: img("body_lower"),
      upper: img("body_upper"),
      handL: img("left_hand"),
      handR: img("right_hand"),
    };
    this.parts.head.setTint(look.skinTint);
    this.parts.handL.setTint(look.skinTint);
    this.parts.handR.setTint(look.skinTint);
    this.parts.upper.setTint(look.shirtColor);
    this.parts.lower.setTint(look.lowerTint);

    this.heldBall = scene.add.image(0, 0, "ball").setVisible(false);
    const dia = T.throw.ballRadiusM * 2 * M;
    this.heldBall.setDisplaySize(dia, dia);

    // the held ball slots under the front hand, so the near hand reads
    // as gripping the ball while the far hand supports it from behind.
    // Owner-corrected z-order: LEFT hand in front, right hand behind,
    // and the shirt tucks INTO the trouser band (upper under lower).
    this.container = scene.add.container(0, 0, [
      this.parts.handR,
      this.parts.upper,
      this.parts.lower,
      this.parts.head,
      this.heldBall,
      this.parts.handL,
    ]);
    this.place(this.cur, null);
  }

  /** The ball-look tint (Permanent Effect: "balls become more red"). */
  setBallTint(tint: number) {
    this.heldBall.setTint(tint);
  }

  /** Mirror the whole figure to face the X direction of travel. */
  setFacing(right: boolean) {
    this.facingRight = right;
    this.container.setScale(right ? 1 : -1, 1);
  }

  get facing(): boolean {
    return this.facingRight;
  }

  /**
   * Chase the pose for this state. dt smooths transitions; pass a big dt
   * (e.g. 1) to snap - replays/teleports that must not glide.
   */
  applyPose(state: PoseState, dt: number) {
    this.idleT += dt;
    let target: RigPose;
    if (state.kind === "idle") {
      const itch = (this.idleT - this.nextItchAt) / ITCH_DURATION_S;
      if (itch > 1) this.nextItchAt = this.idleT + rollItchDelayS();
      target = idlePose(this.idleT, this.idleTraits, itch);
    } else {
      // doing something - the next itch waits for a calm moment
      this.nextItchAt = Math.max(this.nextItchAt, this.idleT + 5);
      target = computePose(state);
    }
    const k = Math.min(1, 1 - Math.exp(-SMOOTH_RATE * dt));
    const ease = (c: V2, t: V2): V2 => ({
      x: c.x + (t.x - c.x) * k,
      y: c.y + (t.y - c.y) * k,
    });
    this.cur = {
      lower: ease(this.cur.lower, target.lower),
      upper: ease(this.cur.upper, target.upper),
      head: ease(this.cur.head, target.head),
      handL: ease(this.cur.handL, target.handL),
      handR: ease(this.cur.handR, target.handR),
      tilt: target.tilt,
      ball: target.ball,
    };
    this.curTilt += (target.tilt - this.curTilt) * k;
    this.place(this.cur, target.ball);
  }

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y);
  }

  setDepth(depth: number) {
    this.container.setDepth(depth);
  }

  setAlpha(alpha: number) {
    this.container.setAlpha(alpha);
  }

  destroy() {
    this.container.destroy(); // children die with it
  }

  private place(pose: RigPose, ball: V2 | null) {
    for (const name of DRAW_ORDER) {
      const anchor = PART_ANCHORS[name];
      const p = pose[name];
      // pose space is +y UP from the feet; Phaser's is +y down
      this.parts[name].setPosition(anchor.x + p.x, -(anchor.y + p.y));
    }
    if (ball) {
      this.heldBall.setVisible(true).setPosition(ball.x, -ball.y);
    } else {
      this.heldBall.setVisible(false);
    }
    // rotation applies in SCREEN space (after the mirror), so the pose
    // tilt must flip with facing to keep leaning INTO the travel
    // direction; the face-plant `angle` stays screen-space, as it always
    // was for the single-sprite character
    const dir = this.facingRight ? 1 : -1;
    this.container.setAngle(this.angle + this.curTilt * dir);
  }
}
