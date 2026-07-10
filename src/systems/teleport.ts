import Phaser from "phaser";
import { T } from "../tuning";
import { toScreen } from "../world";
import { TeleportOrb } from "../powerup";
import { burst, flash } from "../juice";
import { playSfx } from "../sfx";
import type { Player } from "../player";
import type { AimController } from "../aiming";
import type { Ball } from "../ball";

// The teleport power-up, local-player side: renders the (authority-owned)
// orb via TeleportOrb, checks OUR OWN balls against it — never remote
// players' balls; their hits are the authority's ruling, delivered as a
// `teleported` event — and runs the levitate → fall → face-down → get-up
// state machine. CourtScene ticks it and asks isLevitating.

const ZAP = [0x2e7bff, 0x9fd0ff, 0xffffff] as const;

interface Xyz {
  x: number;
  d: number;
  h: number;
}

export interface TeleportDeps {
  aim: AimController;
  /** the timed-out-while-aiming weak up-throw (a slam attempt) */
  throwWeak: () => void;
  /** teleport happened — recording system anchors slam replays on this */
  onTeleport: (from: Xyz, to: Xyz) => void;
  /** our ball took orb `seq` — report it upstream (Backend.reportOrbHit) */
  onOrbHit: (seq: number) => void;
}

export class TeleportSystem {
  readonly orb: TeleportOrb;
  state: "none" | "levitate" | "fall" | "down" = "none";

  private timer = 0;
  private returnD = 0; // depth row to fall back onto
  private fallV = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
    private readonly deps: TeleportDeps,
  ) {
    this.orb = new TeleportOrb(scene);
  }

  get isLevitating(): boolean {
    return this.state === "levitate";
  }

  /** Tick the orb, check OUR ball hits, run the player state machine. */
  update(dt: number, balls: Ball[]) {
    this.orb.update(dt);

    if (this.state === "none") {
      for (const b of balls) {
        if (b.done || !b.own) continue;
        const p = b.pos;
        const hit = this.orb.hitTest(p.x, p.d, p.h);
        if (hit) {
          // optimistic: zap NOW for the prototype feel; the authority's
          // confirmation (orbRemoved + teleported) dedupes by seq/state
          this.orb.removeBySeq(hit.seq, true);
          this.deps.onOrbHit(hit.seq);
          b.consume();
          this.teleportTo(hit);
          break;
        }
      }
    }

    if (this.state === "levitate") {
      // suspended, drifting down a little — even while aiming
      this.player.airH -= T.tp.sinkSpeedM * dt;
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.deps.aim.isAiming) {
          // time's up mid-aim: the ball squirts weakly straight up
          this.deps.aim.cancel();
          this.deps.throwWeak(); // triggers onThrowReleased → fall
        } else {
          this.startFall();
        }
      }
    } else if (this.state === "fall") {
      this.fallV += T.throw.gravityM * dt;
      this.player.airH -= this.fallV * dt;
      // drift back to the depth row they threw from
      this.player.d += (this.returnD - this.player.d) * Math.min(1, 4 * dt);
      if (this.player.airH <= 0) {
        this.player.airH = 0;
        this.player.d = this.returnD;
        this.state = "down";
        this.timer = T.tp.lieS;
        playSfx(this.scene, "sfx_bounce", 0.6);
        // face-plant: pivot over the feet onto the floor
        this.scene.tweens.add({
          targets: this.player.sprite,
          angle: 90,
          duration: 240,
          ease: "Quad.easeIn",
        });
      }
    } else if (this.state === "down") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = "none";
        this.scene.tweens.add({
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

  /** The levitation throw is the last act up there — falling starts now. */
  onThrowReleased() {
    if (this.state === "levitate") this.startFall();
  }

  /**
   * The authority ruled that OUR ball hit the orb. Usually we predicted
   * it (already levitating) — then this is a no-op. If our variable-dt
   * ball narrowly missed where the fixed-dt ruling hit, honor the ruling
   * and zap late.
   */
  confirmTeleport(to: Xyz) {
    if (this.state !== "none") return;
    this.teleportTo(to);
  }

  private teleportTo(dest: Xyz) {
    const from: Xyz = {
      x: this.player.x,
      d: this.player.d,
      h: this.player.airH,
    };
    this.deps.onTeleport(from, dest);

    // zapp out…
    const fs = toScreen(from.x, from.d, from.h + 1);
    flash(this.scene, fs.sx, fs.sy, 30);
    burst(this.scene, fs.sx, fs.sy, 24, ZAP, 260);

    this.returnD = this.player.d;
    this.player.stop();
    this.player.x = dest.x;
    this.player.d = dest.d;
    this.player.airH = dest.h;
    this.player.control = "throwOnly";
    this.state = "levitate";
    this.timer = T.orb.levitateS;

    // …zapp in
    const ts = toScreen(dest.x, dest.d, dest.h + 1);
    flash(this.scene, ts.sx, ts.sy, 44);
    burst(this.scene, ts.sx, ts.sy, 36, ZAP, 300);
    playSfx(this.scene, "sfx_pop", 0.8);
  }

  private startFall() {
    this.state = "fall";
    this.fallV = 0;
    this.player.control = "none";
    if (this.deps.aim.isAiming) this.deps.aim.cancel();
  }
}
