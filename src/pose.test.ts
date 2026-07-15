import { describe, expect, it } from "vitest";
import {
  bodyAim,
  computePose,
  idlePose,
  lerpPoseState,
  PART_ANCHORS,
  rollIdleTraits,
  rollItchDelayS,
  type PoseState,
} from "./shared/pose";

// The animation contract: these tests pin the *shape* of each pose (what
// must be true for the animation to read right), not exact pixel values -
// the constants are feel-tuning territory.

const at = (s: Partial<PoseState> & { kind: PoseState["kind"] }): PoseState => ({
  t: 0,
  ...s,
});

describe("computePose", () => {
  it("idle: everything at anchors, no held ball", () => {
    const p = computePose(at({ kind: "idle" }));
    for (const part of [p.lower, p.upper, p.head, p.handL, p.handR])
      expect(part).toEqual({ x: 0, y: 0 });
    expect(p.tilt).toBe(0);
    expect(p.ball).toBeNull();
  });

  it("walk: bobs, hands swing in antiphase, leans into travel", () => {
    const p = computePose(at({ kind: "walk", t: 0.1 }));
    expect(p.upper.y).toBeGreaterThan(0); // mid-stride bob
    expect(p.handL.x).toBeCloseTo(-p.handR.x); // antiphase swing
    expect(p.handL.x).not.toBeCloseTo(0);
    expect(p.tilt).toBeGreaterThan(0);
    // bob is periodic and grounded: at the stride change it touches 0
    const grounded = computePose(at({ kind: "walk", t: 0 }));
    expect(grounded.upper.y).toBeCloseTo(0);
  });

  it("aim: ball held up near the hands, above the head anchor", () => {
    const p = computePose(at({ kind: "aim", aimAngle: 0.9, aimPower: 0 }));
    expect(p.ball).not.toBeNull();
    expect(p.ball!.y).toBeGreaterThan(PART_ANCHORS.head.y + 14); // clears the crown
    // hands raised from their side anchors up above the head anchor
    expect(PART_ANCHORS.handL.y + p.handL.y).toBeGreaterThan(
      PART_ANCHORS.head.y,
    );
    expect(PART_ANCHORS.handR.y + p.handR.y).toBeGreaterThan(
      PART_ANCHORS.head.y,
    );
  });

  it("cheer: hands pump above the head in a quick rhythm, body hops", () => {
    // sample one full second - hands must reach clear above the crown at
    // the pump's top and drop back toward shoulders at the bottom
    let maxHand = -Infinity;
    let minHand = Infinity;
    let maxBob = 0;
    for (let t = 0; t <= 1; t += 1 / 60) {
      const p = computePose(at({ kind: "cheer", t }));
      const handY = PART_ANCHORS.handL.y + p.handL.y;
      maxHand = Math.max(maxHand, handY);
      minHand = Math.min(minHand, handY);
      maxBob = Math.max(maxBob, p.head.y);
      expect(p.ball).toBeNull();
    }
    expect(maxHand).toBeGreaterThan(PART_ANCHORS.head.y + 14); // thrown in the air
    expect(maxHand - minHand).toBeGreaterThan(15); //   a real pump, not a twitch
    expect(maxBob).toBeGreaterThan(2); //               the bob
  });

  it("cheer: the rhythm is quick - several pumps per second", () => {
    // the hand height at t and one full pump later must match (periodic),
    // with the period well under a second ("quick rhythm")
    const handAt = (t: number) =>
      computePose(at({ kind: "cheer", t })).handL.y;
    const period = 1 / 2.4; // CHEER_HZ - 20% slower per owner feedback
    expect(handAt(0.1)).toBeCloseTo(handAt(0.1 + period), 5);
    expect(handAt(0.1)).not.toBeCloseTo(handAt(0.1 + period / 2), 0);
  });

  it("cheer, weary (AFK): identical rhythm at the same clock, head hangs", () => {
    // the SPEED difference is the caller's job (the cheer clock advances
    // at WEARY_CHEER_RATE); the pose itself only lowers the head
    for (const t of [0, 0.13, 0.31, 0.5]) {
      const fresh = computePose(at({ kind: "cheer", t }));
      const weary = computePose(at({ kind: "cheer", t, weary: true }));
      expect(weary.head.y).toBeLessThan(fresh.head.y - 2); // hangs clearly
      expect(weary.handL).toEqual(fresh.handL); // hands still pump the same
      expect(weary.handR).toEqual(fresh.handR);
    }
  });

  it("point: the front arm extends along the aim, no ball, other hand rests", () => {
    const fwd = computePose(at({ kind: "point", aimAngle: 0 }));
    const up = computePose(at({ kind: "point", aimAngle: Math.PI / 2 }));
    const armY = (p: ReturnType<typeof computePose>) =>
      PART_ANCHORS.handL.y + p.handL.y;
    const armX = (p: ReturnType<typeof computePose>) =>
      PART_ANCHORS.handL.x + p.handL.x;
    expect(armX(fwd)).toBeGreaterThan(armX(up)); // forward aim reaches out…
    expect(armY(up)).toBeGreaterThan(armY(fwd)); // …upward aim reaches up
    expect(armY(up)).toBeGreaterThan(PART_ANCHORS.head.y); // clearly raised
    expect(fwd.handR).toEqual({ x: 0, y: 0 }); // the back hand rests
    expect(fwd.ball).toBeNull(); // nothing in hand - that's the point
  });

  it("airpunch: jabs out at the peak and returns by the end", () => {
    const rest = computePose(at({ kind: "point", aimAngle: 0 }));
    const peak = computePose(at({ kind: "airpunch", aimAngle: 0, t: 0.5 }));
    const done = computePose(at({ kind: "airpunch", aimAngle: 0, t: 1 }));
    expect(peak.handL.x).toBeGreaterThan(rest.handL.x); // extra reach
    expect(peak.tilt).toBeGreaterThan(0); //               leans into it
    expect(done.handL.x).toBeCloseTo(rest.handL.x, 5); // back to the point
    expect(done.tilt).toBeCloseTo(0, 5);
  });

  it("aim: charging pulls the hold back against the aim direction", () => {
    const soft = computePose(at({ kind: "aim", aimAngle: 0, aimPower: 0 }));
    const full = computePose(at({ kind: "aim", aimAngle: 0, aimPower: 1 }));
    // aim straight ahead (+x): full power drags hands and ball backwards
    expect(full.handL.x).toBeLessThan(soft.handL.x);
    expect(full.ball!.x).toBeLessThan(soft.ball!.x);
    // and leans the body back
    expect(full.tilt).toBeLessThan(soft.tilt);
  });

  it("throw: sweeps to a forward follow-through and releases the ball", () => {
    const aim = at({ kind: "aim", aimAngle: 0.9, aimPower: 1 });
    const start = at({ kind: "throw", t: 0, aimAngle: 0.9, aimPower: 1 });
    const end = at({ kind: "throw", t: 1, aimAngle: 0.9, aimPower: 1 });
    // t=0 matches the charged aim hold (seamless hand-off)
    expect(computePose(start).handL).toEqual(computePose(aim).handL);
    // the ball leaves the hands the moment the throw starts
    expect(computePose(start).ball).toBeNull();
    // follow-through: hands ahead of the charged hold, body tips forward
    expect(computePose(end).handL.x).toBeGreaterThan(computePose(start).handL.x);
    expect(computePose(end).tilt).toBeGreaterThan(0);
  });

  it("fall/lie/getup: both hands up, staying up until fully upright", () => {
    for (const kind of ["fall", "lie", "getup"] as const) {
      const p = computePose(at({ kind, t: 0.2 }));
      // ABSOLUTE check: raised hands must clear the head anchor, no
      // matter where the resting hand anchors have been tuned to
      expect(PART_ANCHORS.handL.y + p.handL.y).toBeGreaterThan(
        PART_ANCHORS.head.y,
      );
      expect(PART_ANCHORS.handR.y + p.handR.y).toBeGreaterThan(
        PART_ANCHORS.head.y,
      );
      expect(p.ball).toBeNull();
    }
    // the waggle animates the fall but never the lie
    const fallA = computePose(at({ kind: "fall", t: 0.1 }));
    const fallB = computePose(at({ kind: "fall", t: 0.2 }));
    expect(fallA.handL.y).not.toBeCloseTo(fallB.handL.y);
    const lieA = computePose(at({ kind: "lie", t: 0.1 }));
    const lieB = computePose(at({ kind: "lie", t: 0.2 }));
    expect(lieA.handL.y).toBeCloseTo(lieB.handL.y);
  });
});

describe("bodyAim (backwards aim turns the character around)", () => {
  it("forward aims keep facing and angle untouched", () => {
    expect(bodyAim(0.9)).toEqual({ facing: 1, aimAngle: 0.9 });
    expect(bodyAim(-0.4)).toEqual({ facing: 1, aimAngle: -0.4 });
  });

  it("backward aims flip facing and mirror the angle", () => {
    const up = 2.4; // up-and-behind
    const b = bodyAim(up);
    expect(b.facing).toBe(-1);
    // vertical component preserved, horizontal now forward
    expect(Math.sin(b.aimAngle)).toBeCloseTo(Math.sin(up));
    expect(Math.cos(b.aimAngle)).toBeCloseTo(-Math.cos(up));
    expect(Math.cos(b.aimAngle)).toBeGreaterThan(0);
  });

  it("down-and-behind mirrors the same way", () => {
    const b = bodyAim(-2.8);
    expect(b.facing).toBe(-1);
    expect(Math.sin(b.aimAngle)).toBeCloseTo(Math.sin(-2.8));
    expect(Math.cos(b.aimAngle)).toBeGreaterThan(0);
  });
});

describe("idlePose (the local standing-around life)", () => {
  const traits = { breathHz: 0.3, breathAmp: 1 };

  it("breathes: chest and head move over time, bounded by the amplitude", () => {
    const a = idlePose(0.4, traits);
    const b = idlePose(1.4, traits);
    expect(a.head.y).not.toBeCloseTo(b.head.y);
    for (const t of [0, 0.7, 1.9, 3.2])
      expect(Math.abs(idlePose(t, traits).head.y)).toBeLessThanOrEqual(1);
    expect(idlePose(0.4, traits).ball).toBeNull();
  });

  it("characters with different traits breathe out of step", () => {
    const other = { breathHz: 0.38, breathAmp: 1 };
    expect(idlePose(2, traits).head.y).not.toBeCloseTo(
      idlePose(2, other).head.y,
    );
  });

  it("mid-itch the front hand reaches the belly, then returns", () => {
    const rest = idlePose(1, traits, -1);
    const mid = idlePose(1, traits, 0.5);
    const done = idlePose(1, traits, 1.2);
    // handL crosses from its side anchor (-20) toward the belly (+9)
    expect(mid.handL.x).toBeGreaterThan(20);
    expect(rest.handL.x).toBeCloseTo(0);
    expect(done.handL.x).toBeCloseTo(0);
    // the back hand never joins in
    expect(mid.handR.x).toBeCloseTo(0);
  });

  it("rolled traits and itch delays stay in their design ranges", () => {
    for (let i = 0; i < 20; i++) {
      const t = rollIdleTraits();
      expect(t.breathHz).toBeGreaterThan(0.2);
      expect(t.breathHz).toBeLessThan(0.4);
      const d = rollItchDelayS();
      expect(d).toBeGreaterThanOrEqual(60);
      expect(d).toBeLessThanOrEqual(180);
    }
  });
});

describe("lerpPoseState", () => {
  it("lerps clocks and aim within the same kind", () => {
    const a = at({ kind: "aim", t: 0, aimAngle: 0.4, aimPower: 0.2 });
    const b = at({ kind: "aim", t: 1, aimAngle: 0.8, aimPower: 0.6 });
    const m = lerpPoseState(a, b, 0.5);
    expect(m.t).toBeCloseTo(0.5);
    expect(m.aimAngle).toBeCloseTo(0.6);
    expect(m.aimPower).toBeCloseTo(0.4);
  });

  it("snaps to the nearer sample across kind changes", () => {
    const a = at({ kind: "walk", t: 3 });
    const b = at({ kind: "aim", t: 0, aimAngle: 1 });
    expect(lerpPoseState(a, b, 0.4).kind).toBe("walk");
    expect(lerpPoseState(a, b, 0.6).kind).toBe("aim");
  });
});
