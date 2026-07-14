import Phaser from "phaser";
import { T } from "./tuning";
import { M } from "./world";
import { BASE_ATMOSPHERE } from "./shared/tierRules";
import type { SunMood } from "./shared/tierChanges";

// The desert sky: an endless procession of suns arcing across the horizon.
// Each "configuration" is randomly a lone big sun, a lone small sun, or a
// big sun with a small companion. The dominant sun drives every drop
// shadow on the court via lightDir(). The tier's Atmosphere Change hands
// in a MOOD — colors, size, pace, pulse — via setMood().

/** Where the light comes from, reduced to what shadows need. */
export interface LightDir {
  dx: number; //   -1..1 — direction shadows POINT (away from the sun)
  elev: number; // 0..1  — 0 = sun on the horizon, 1 = apex
}

type SunConfig = "bigSolo" | "smallSolo" | "bigPlusCompanion";
const CONFIGS: SunConfig[] = ["bigSolo", "smallSolo", "bigPlusCompanion"];

interface SunSprite {
  glow: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  offX: number; // offset from the config anchor, px
  offY: number;
}

export class SunSystem {
  private suns: SunSprite[] = [];
  private p = 0; //          0..1 progress across the sky
  private traverseS = 0;
  private gapLeft = 0;
  private t = 0; //          wall clock for the pulse
  private mood: SunMood = { ...BASE_ATMOSPHERE.sun };
  // shadows ease toward the current sun instead of snapping between configs
  private smoothed: LightDir = { dx: 0, elev: 1 };

  private readonly leftEdge = -400;
  private readonly rightEdge = T.court.lengthM * M + 400;
  private readonly horizon = T.court.floorBaseY;

  constructor(private readonly scene: Phaser.Scene) {
    this.spawnConfig();
  }

  /** The tier's Atmosphere Change: recolor/resize/repace the procession.
   *  Applies to the suns in the sky right now AND every one after. */
  setMood(m: SunMood) {
    this.mood = { ...m };
    for (const s of this.suns) {
      s.core.setFillStyle(m.coreColor, 0.95);
      s.glow.setFillStyle(m.glowColor, T.sky.glowAlpha);
    }
  }

  update(dt: number) {
    this.t += dt;
    if (this.suns.length === 0) {
      this.gapLeft -= dt;
      if (this.gapLeft <= 0) this.spawnConfig();
    } else {
      this.p += (dt * this.mood.speedScale) / this.traverseS;
      if (this.p >= 1) {
        for (const s of this.suns) {
          s.glow.destroy();
          s.core.destroy();
        }
        this.suns = [];
        this.gapLeft = T.sky.gapS;
      } else {
        const ax = Phaser.Math.Linear(this.leftEdge, this.rightEdge, this.p);
        const ay = this.horizon - T.sky.arcPeakPx * Math.sin(Math.PI * this.p);
        // the mood's size, plus the tier-2 pulse breathing on top of it
        const pulse = this.mood.pulsate
          ? 1 + T.sky.pulsateAmp * Math.sin(Math.PI * 2 * T.sky.pulsateHz * this.t)
          : 1;
        const scale = this.mood.sizeScale * pulse;
        for (const s of this.suns) {
          s.glow.setPosition(ax + s.offX, ay + s.offY).setScale(scale);
          s.core.setPosition(ax + s.offX, ay + s.offY).setScale(scale);
        }
      }
    }

    // ease the reported light toward the raw target — no shadow jerks
    // when one sun sets and the next rises
    const target = this.rawLightDir();
    const k = 1 - Math.exp(-T.sky.lightLerp * dt);
    this.smoothed.dx += (target.dx - this.smoothed.dx) * k;
    this.smoothed.elev += (target.elev - this.smoothed.elev) * k;
  }

  /** Smoothed light for shadows; eases between suns instead of snapping. */
  lightDir(): LightDir {
    return { ...this.smoothed };
  }

  /** Instantaneous light from the dominant (first) sun; neutral in gaps. */
  private rawLightDir(): LightDir {
    if (this.suns.length === 0) return { dx: 0, elev: 1 };
    const sunX = this.suns[0].core.x;
    const midX = (T.court.lengthM * M) / 2;
    const halfSpan = (this.rightEdge - this.leftEdge) / 2;
    return {
      dx: Phaser.Math.Clamp((midX - sunX) / halfSpan, -1, 1),
      elev: Math.sin(Math.PI * Math.min(this.p, 1)),
    };
  }

  private spawnConfig() {
    this.p = 0;
    this.traverseS = Phaser.Math.FloatBetween(
      T.sky.traverseMinS,
      T.sky.traverseMaxS,
    );
    const config = Phaser.Math.RND.pick(CONFIGS);

    const add = (radius: number, offX: number, offY: number) => {
      const glow = this.scene.add
        .circle(0, 0, radius * T.sky.glowScale, this.mood.glowColor, T.sky.glowAlpha)
        .setDepth(-95);
      const core = this.scene.add
        .circle(0, 0, radius, this.mood.coreColor, 0.95)
        .setDepth(-95);
      this.suns.push({ glow, core, offX, offY });
    };

    if (config === "bigSolo") {
      add(T.sky.bigSunPx, 0, 0);
    } else if (config === "smallSolo") {
      add(T.sky.smallSunPx, 0, 0);
    } else {
      add(T.sky.bigSunPx, 0, 0); // dominant first — it owns the shadows
      add(T.sky.smallSunPx, T.sky.companionOffsetX, T.sky.companionOffsetY);
    }

    this.update(0); // position immediately, no one-frame pop at (0,0)
  }
}

/**
 * World-px x-offset for a drop shadow cast by something `objHeightM`
 * meters tall (or high). Low sun → long lean; overhead → underfoot.
 */
export function shadowShift(objHeightM: number, light: LightDir): number {
  return (
    light.dx * objHeightM * M * T.sky.shadowSlope * (1 - 0.5 * light.elev)
  );
}
