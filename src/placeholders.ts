import Phaser from "phaser";
import { T } from "./tuning";
import {
  M,
  RIM,
  FREE_THROW_X,
  WALL_LEFT_X,
  WALL_RIGHT_X,
  floorY,
  sortDepth,
} from "./world";
import type { HoopGeometry } from "./shared/tierRules";
import type { BallLookId, CourtLookId, HoopLook } from "./shared/tierChanges";

// Placeholder pixel art, generated at boot. Any texture the user supplies
// in public/assets/ (see the README there) takes priority - we only
// generate a stand-in when the key is missing from the texture cache.

const SHIRT_COLOURS = [
  0xd96a6a, 0x6a9ad9, 0x6ac48a, 0xd9b56a, 0xa97ad9, 0xd97ab0, 0x7ac4c4,
];

// Skin: MULTIPLY tints over the pale part art - 0xffffff leaves it as
// drawn, browner entries tan it. Deliberately gentle steps ("colorized
// only a little bit"); head + both hands always share one entry.
const SKIN_TINTS = [
  0xffffff, 0xf5e0c8, 0xe8c8a4, 0xd4a97c, 0xb98a5e,
];

// Trousers: gentle shade variation over body_lower's own brown.
const LOWER_TINTS = [0xffffff, 0xe8e0d4, 0xd8c8b8, 0xc8b8ac];

export const HEAD_VARIANTS = 3;

/** Rolled-once identity helper: an entry of `pool`, sticky under `key`. */
function persistentPick(pool: readonly number[], key: string): number {
  const stored = localStorage.getItem(key);
  if (stored) {
    const n = parseInt(stored, 16);
    if (pool.includes(n)) return n;
  }
  const v = pool[Math.floor(Math.random() * pool.length)];
  localStorage.setItem(key, v.toString(16));
  return v;
}

/** The player's skin tint (head + hands) - rolled once per storage key. */
export function persistentSkin(storageKey = "shootDaHoop.skin"): number {
  return persistentPick(SKIN_TINTS, storageKey);
}

/** The trouser tint - rolled once, seeded independently of the skin. */
export function persistentLower(storageKey = "shootDaHoop.lower"): number {
  return persistentPick(LOWER_TINTS, storageKey);
}

/** Which head (1-based) - rolled once per storage key. */
export function persistentHead(storageKey = "shootDaHoop.head"): number {
  const stored = Number(localStorage.getItem(storageKey));
  if (Number.isInteger(stored) && stored >= 1 && stored <= HEAD_VARIANTS)
    return stored;
  const v = 1 + Math.floor(Math.random() * HEAD_VARIANTS);
  localStorage.setItem(storageKey, String(v));
  return v;
}

/**
 * The player's shirt colour - their visual identity, rolled once and then
 * persistent under the given localStorage key. OFFLINE that key is global
 * to the browser; in a LOBBY main.ts passes a per-lobby key, so each lobby
 * remembers its own colour (rolled the first time you enter it).
 */
export function persistentShirt(storageKey = "shootDaHoop.shirt"): number {
  return persistentPick(SHIRT_COLOURS, storageKey);
}

export function ensurePlaceholderTextures(scene: Phaser.Scene) {
  const tex = scene.textures;

  // 3×3 white square - particle building block
  if (!tex.exists("px")) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff).fillRect(0, 0, 3, 3);
    g.generateTexture("px", 3, 3);
    g.destroy();
  }

  // Ball - the platform's 🏀 emoji rendered to a canvas (owner ask
  // 2026-07-17: "make the ball look more like an actual basketball -
  // scale an emoji if you have to"). The glyph is alpha-cropped so the
  // ball FILLS the texture: setDisplaySize then gives the physics-true
  // diameter instead of an emoji floating inside its em-box padding.
  // Drawn at 2x the on-screen size; the nearest-neighbour downscale
  // keeps it crisp. Platforms with no colour-emoji font fall back to
  // the drawn ball.
  if (!tex.exists("ball")) {
    const px = Math.max(10, Math.round(T.throw.ballRadiusM * 2 * M));
    const emoji = emojiBallCanvas(px * 2);
    if (emoji) {
      tex.addCanvas("ball", emoji);
    } else {
      const r = px / 2;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xd2691e).fillCircle(r, r, r);
      g.fillStyle(0xf0955a).fillCircle(r * 0.8, r * 0.8, r * 0.4); // highlight
      g.lineStyle(2, 0x8a4310);
      g.beginPath();
      g.moveTo(r, 0);
      g.lineTo(r, px);
      g.strokePath();
      g.beginPath();
      g.moveTo(0, r);
      g.lineTo(px, r);
      g.strokePath();
      g.generateTexture("ball", px, px);
      g.destroy();
    }
  }

  // Hoop 4's pink-purple ball: a RECOLORED TEXTURE, not a tint - the
  // orange emoji has near-zero blue, so no multiply tint can make it
  // purple (the same trap the HUD icons hit; the fix is the same
  // sepia-first filter chain, see style.css). Recolors whatever "ball"
  // ended up being (emoji, drawn stand-in or user art); where
  // ctx.filter is unsupported, consumers fall back to the tint.
  if (!tex.exists("ball_pinkpurple")) {
    const src = tex.get("ball").getSourceImage();
    const recolored = recolorBallCanvas(
      src as HTMLImageElement | HTMLCanvasElement,
    );
    if (recolored) {
      tex.addCanvas("ball_pinkpurple", recolored);
      pinkpurpleBallReady = true;
    }
  }

  ensurePartPlaceholders(scene);
}

/** ctx.filter recolor succeeded at boot - the helpers below key off it. */
let pinkpurpleBallReady = false;

// PLACEHOLDER (tune): the pink-purple chain - sepia first normalizes the
// orange before the rotate lands it on purple (browser-compared rule,
// 2026-07-17); keep it visually matched with style.css .pinkpurple
const PINKPURPLE_FILTER =
  "sepia(1) saturate(6) hue-rotate(225deg) brightness(0.9)";

function recolorBallCanvas(
  src: HTMLImageElement | HTMLCanvasElement,
): HTMLCanvasElement | null {
  const w = src.width;
  const h = src.height;
  if (!w || !h) return null;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx || typeof ctx.filter !== "string") return null;
  ctx.filter = PINKPURPLE_FILTER;
  if (ctx.filter === "none") return null; // parsed away = unsupported
  ctx.drawImage(src, 0, 0);
  return out;
}

/** The texture a ball of this look wears - the recolored one when the
 *  boot-time recolor succeeded, else the base ball (tint fallback). */
export function ballTexture(look: BallLookId): string {
  return look === "pinkpurple" && pinkpurpleBallReady
    ? "ball_pinkpurple"
    : "ball";
}

/** The multiply tint that goes WITH ballTexture(look): none when the
 *  look rides its own recolored texture. */
export function ballTintFor(look: BallLookId): number {
  if (look === "pinkpurple" && pinkpurpleBallReady) return 0xffffff;
  return T.ballLooks[look] ?? T.ballLooks.classic;
}

/**
 * Render 🏀 onto a square canvas, cropped to the glyph's alpha bounding
 * box so the ball artwork spans the full texture. Returns null when the
 * platform rendered nothing (no colour-emoji font) - caller falls back.
 */
function emojiBallCanvas(sizePx: number): HTMLCanvasElement | null {
  const pad = 8;
  const raw = sizePx * 2 + pad * 2;
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = raw;
  const sc = scratch.getContext("2d", { willReadFrequently: true });
  if (!sc) return null;
  sc.textAlign = "center";
  sc.textBaseline = "middle";
  sc.font = `${sizePx * 2}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  sc.fillText("🏀", raw / 2, raw / 2);

  const img = sc.getImageData(0, 0, raw, raw).data;
  let minX = raw;
  let minY = raw;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < raw; y++) {
    for (let x = 0; x < raw; x++) {
      if (img[(y * raw + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // nothing drawn - no emoji support

  // center the glyph's bounding box inside a square, scale to size
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const box = Math.max(w, h);
  const out = document.createElement("canvas");
  out.width = out.height = sizePx;
  out
    .getContext("2d")!
    .drawImage(
      scratch,
      minX - (box - w) / 2,
      minY - (box - h) / 2,
      box,
      box,
      0,
      0,
      sizePx,
      sizePx,
    );
  return out;
}

/**
 * Resolve a character part's texture: the user-provided file when it was
 * probed+loaded, otherwise the generated `ph_` stand-in (always present).
 */
export function partTexture(scene: Phaser.Scene, name: string): string {
  return scene.textures.exists(name) ? name : `ph_${name}`;
}

// Stand-ins for the character part files, drawn in the same palette
// discipline as the real art: heads/hands PALE (a multiply skin tint tans
// them), the shirt WHITE (a hard tint recolours it), the trousers brown.
const PALE_SKIN = 0xf2c9a0;

function ensurePartPlaceholders(scene: Phaser.Scene) {
  const make = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  };

  const outlinedCircle = (
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    fill: number,
  ) => {
    g.fillStyle(0x000000).fillCircle(cx, cy, r);
    g.fillStyle(fill).fillCircle(cx, cy, r - 2);
  };

  for (const v of [1, 2, 3]) {
    make(`ph_head_v${v}`, 26, 26, (g) => {
      outlinedCircle(g, 13, 13, 13, PALE_SKIN);
      if (v === 2) {
        // haired variant: a dark cap over the crown
        g.fillStyle(0x6a5a4a);
        g.fillCircle(13, 13, 11);
        g.fillStyle(PALE_SKIN).fillRect(2, 12, 22, 12);
      } else if (v === 3) {
        g.fillStyle(0x6a5a4a).fillRect(4, 4, 8, 3); // a side tuft
      }
      g.fillStyle(0x2b2b2b).fillRect(19, 11, 2, 2); // eye (faces right)
    });
  }

  make("ph_body_upper", 43, 36, (g) => {
    // white t-shirt dome with an outline
    g.fillStyle(0x000000).fillRoundedRect(0, 0, 43, 36, { tl: 18, tr: 18, bl: 0, br: 0 });
    g.fillStyle(0xffffff).fillRoundedRect(2, 2, 39, 34, { tl: 16, tr: 16, bl: 0, br: 0 });
  });

  make("ph_body_lower", 43, 12, (g) => {
    g.fillStyle(0x000000).fillRect(0, 0, 43, 12);
    g.fillStyle(0x8a5a28).fillRect(2, 0, 39, 10);
  });

  for (const key of ["ph_left_hand", "ph_right_hand"]) {
    make(key, 14, 14, (g) => outlinedCircle(g, 7, 7, 7, PALE_SKIN));
  }
}

/** The backdrop's recolour veil - the tier's sky colour fades over the
 *  whole desert (owner 2026-07-15: "the whole background becomes light
 *  gray"). `veil` is the recolour's 0..1 strength; setPalette derives
 *  the layer shades from the tier's sky colour. */
export interface Backdrop {
  veil: number;
  setPalette(sky: number): void;
}

/** Desert backdrop: banded sky over rolling dunes. Suns live in sky.ts. */
export function drawBackdrop(scene: Phaser.Scene): Backdrop {
  const left = -900;
  const right = T.court.lengthM * M + 900;
  const w = right - left;
  const skyTop = -700;
  const horizon = T.court.floorBaseY;

  // desert sky in warm bands
  const bands = [0xffe9b5, 0xf9d492, 0xf0b96f, 0xe59d57];
  const bandH = (horizon - skyTop) / bands.length;
  bands.forEach((c, i) => {
    scene.add
      .rectangle(left, skyTop + i * bandH, w, bandH + 1, c)
      .setOrigin(0, 0)
      .setDepth(-100);
  });

  // rolling dunes - three rows of overlapping mounds straddling the horizon,
  // drawn once (static silhouettes; only the suns move)
  const rows: { tint: number; rise: number; rx: number; ry: number }[] = [
    { tint: 0xdfb877, rise: 26, rx: 340, ry: 70 }, // far, palest
    { tint: 0xd0a25e, rise: 14, rx: 260, ry: 55 }, // mid
    { tint: 0xc08e4c, rise: 4, rx: 200, ry: 45 }, //  near, deepest
  ];
  const fillDunes = (g: Phaser.GameObjects.Graphics, tints: number[]) => {
    rows.forEach((row, ri) => {
      g.fillStyle(tints[ri]);
      const spacing = row.rx * 1.15;
      // phase each row so crests interleave instead of stacking
      for (let x = left + ri * spacing * 0.45; x < right; x += spacing) {
        g.fillEllipse(x, horizon - row.rise + row.ry / 2, row.rx * 2, row.ry * 2);
      }
    });
    // sand shelf that closes the dune bases at the horizon line
    g.fillStyle(tints[2]).fillRect(left, horizon - 4, w, 4);
  };
  const dunes = scene.add.graphics().setDepth(-90);
  fillDunes(dunes, rows.map((r) => r.tint));

  // sand the court sits on
  scene.add
    .rectangle(left, horizon, w, 900, 0xd4a86a)
    .setOrigin(0, 0)
    .setDepth(-80);

  // ── the recolour veil: a twin of every layer in the tier's sky colour,
  // faded in by `veil`. The sky twin sits UNDER the suns (depth −95) so
  // the procession stays visible on the recoloured sky; the dune/sand
  // twins keep the silhouette layering in derived shades.
  const skyVeil = scene.add
    .rectangle(left, skyTop, w, horizon - skyTop, 0xd9dcdf)
    .setOrigin(0, 0)
    .setDepth(-96)
    .setAlpha(0);
  const duneVeil = scene.add.graphics().setDepth(-89).setAlpha(0);
  const sandVeil = scene.add
    .rectangle(left, horizon, w, 900, 0xd9dcdf)
    .setOrigin(0, 0)
    .setDepth(-79)
    .setAlpha(0);

  let alpha = 0;
  let palette = 0;
  return {
    get veil() {
      return alpha;
    },
    set veil(v: number) {
      alpha = v;
      skyVeil.setAlpha(v);
      duneVeil.setAlpha(v);
      sandVeil.setAlpha(v);
    },
    setPalette(sky: number) {
      if (sky === palette) return;
      palette = sky;
      skyVeil.setFillStyle(sky);
      sandVeil.setFillStyle(darken(sky, 0.88));
      duneVeil.clear();
      // PLACEHOLDER (tune): the dune rows step down in brightness so the
      // silhouettes still read on the recoloured backdrop
      fillDunes(duneVeil, [darken(sky, 0.94), darken(sky, 0.88), darken(sky, 0.82)]);
    },
  };
}

/**
 * Boundary walls past both baselines - sandstone, physical obstacles the
 * ball bounces off (ball.ts). Distinct from the log panel's brick look:
 * the log is a screen-space DOM element, not part of the scene.
 */
export function drawWall(scene: Phaser.Scene) {
  const w = 900; // each wall runs off its edge of the scene
  const top = -700;
  const bot = floorY(T.court.depthM) + 8;
  const g = scene.add.graphics().setDepth(-60);

  const column = (x: number, edgeAtRight: boolean) => {
    // weathered sandstone blocks
    g.fillStyle(0xcfa15f).fillRect(x, top, w, bot - top);
    g.fillStyle(0xbd8c4c);
    for (let y = top; y < bot; y += 30) {
      g.fillRect(x, y, w, 3);
      // staggered vertical joints
      const off = ((y - top) / 30) % 2 === 0 ? 20 : 50;
      for (let bx = x + off; bx < x + w; bx += 64) g.fillRect(bx, y, 3, 30);
    }
    // sun-shaded edge facing the court
    g.fillStyle(0x9a6f38).fillRect(edgeAtRight ? x + w - 5 : x, top, 5, bot - top);
  };

  column(WALL_RIGHT_X * M, false);
  column(WALL_LEFT_X * M - w, true);
}

/** Court-floor skins for the Scene Visual Change (shared/tierChanges.ts). */
const COURT_PALETTES: Record<
  CourtLookId,
  { even: number; odd: number; lip: number; line: number; shine: boolean }
> = {
  standard: {
    even: 0xc98d5a,
    odd: 0xbd8250,
    lip: 0x8a5a34,
    line: 0xf3e2c0,
    shine: false,
  },
  // much darker, like mahogany wood (floor only)
  mahogany: {
    even: 0x5a3220,
    odd: 0x4c2a1a,
    lip: 0x2e1810,
    line: 0xd8c0a0,
    shine: false,
  },
  // the same area turned to glass, fancier than the mahogany version
  glass: {
    even: 0xa9dbe4,
    odd: 0x93cfdc,
    lip: 0x5f93a4,
    line: 0xffffff,
    shine: true,
  },
  // Hoop 4: white court, black painted lines. PLACEHOLDER (tune):
  // near-white planks in two barely-different shades so the stripes
  // still read, a light-gray lip, hard black lines.
  white: {
    even: 0xf4f4f0,
    odd: 0xebebe5,
    lip: 0xc8c8c0,
    line: 0x141414,
    shine: false,
  },
};

/** The court floor band with its painted lines, in the given skin. */
export function drawCourt(
  scene: Phaser.Scene,
  look: CourtLookId = "standard",
): Phaser.GameObjects.Graphics {
  const pal = COURT_PALETTES[look];
  const x0 = 0;
  const x1 = T.court.lengthM * M;
  const yTop = floorY(0);
  const yBot = floorY(T.court.depthM);
  const g = scene.add.graphics().setDepth(-50);

  // planks (alternating meter stripes)
  for (let m = 0; m < T.court.lengthM; m++) {
    g.fillStyle(m % 2 === 0 ? pal.even : pal.odd);
    g.fillRect(x0 + m * M, yTop, M, yBot - yTop);
  }
  // front lip (court edge facing the viewer)
  g.fillStyle(pal.lip).fillRect(x0, yBot, x1 - x0, 8);

  // glass gets diagonal shine streaks sweeping the whole pane
  if (pal.shine) {
    g.lineStyle(10, 0xffffff, 0.18);
    const zh = yBot - yTop;
    for (let hx = x0 - zh; hx < x1; hx += 140) {
      const xa = Math.max(hx, x0);
      const xb = Math.min(hx + zh, x1);
      if (xb <= xa) continue;
      g.beginPath();
      g.moveTo(xa, yBot - (xa - hx));
      g.lineTo(xb, yBot - (xb - hx));
      g.strokePath();
    }
  }

  // ── painted lines: real half-court markings (owner ask 2026-07-17),
  //    drawn in this view's projection - x and d both map LINEARLY to
  //    the screen (32 px/m along, 16 px/m deep), so floor rectangles
  //    stay rectangles and floor circles become 2:1-squashed ellipses ──
  const line = pal.line;

  /** A circle painted ON THE FLOOR: plot it in court meters, project
   *  each point through floorY - the foreshortening falls out free. */
  const floorArc = (
    cxM: number,
    cdM: number,
    rM: number,
    a0: number,
    a1: number,
    steps = 48,
  ) => {
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const px = (cxM + Math.cos(a) * rM) * M;
      const py = floorY(cdM + Math.sin(a) * rM);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.strokePath();
  };

  g.lineStyle(3, line, 0.9);
  g.strokeRect(x0 + 1, yTop + 1, x1 - x0 - 2, yBot - yTop - 2); // boundary

  // half-court line + center circle (radius 1.8 m, like the real thing)
  g.lineStyle(3, line, 0.7);
  const half = (T.court.lengthM / 2) * M;
  g.beginPath();
  g.moveTo(half, yTop);
  g.lineTo(half, yBot);
  g.strokePath();
  floorArc(T.court.lengthM / 2, RIM.d, 1.8, 0, Math.PI * 2);

  // the key (the paint): baseline to the free-throw line, 4.9 m wide,
  // centered on the rim lane; a whisper of fill so it reads as painted
  const keyHalfM = 4.9 / 2;
  const keyX = FREE_THROW_X * M;
  const keyTop = floorY(RIM.d - keyHalfM);
  const keyBot = floorY(RIM.d + keyHalfM);
  g.fillStyle(line, 0.08).fillRect(keyX, keyTop, x1 - keyX, keyBot - keyTop);
  g.lineStyle(3, line, 0.9);
  g.strokeRect(keyX, keyTop, x1 - keyX - 2, keyBot - keyTop);

  // free-throw circle on the key's head: the half away from the hoop is
  // solid, the half inside the key dashed - like the painted original
  floorArc(FREE_THROW_X, RIM.d, 1.8, Math.PI / 2, (Math.PI * 3) / 2);
  g.lineStyle(3, line, 0.75);
  const DASHES = 8;
  for (let i = 0; i < DASHES; i++) {
    const span = Math.PI / DASHES;
    const a0 = -Math.PI / 2 + i * span;
    floorArc(FREE_THROW_X, RIM.d, 1.8, a0, a0 + span * 0.55, 6);
  }

  // the 3-point arc, centered under the rim; the band is narrower than
  // a real court, so the arc runs sideline to sideline (its corner legs
  // would lie ON the sidelines - the boundary already draws them)
  const reach = Math.asin(Math.min(1, T.court.depthM / 2 / T.court.threePtM));
  g.lineStyle(3, line, 0.9);
  floorArc(RIM.x, RIM.d, T.court.threePtM, Math.PI - reach, Math.PI + reach);

  // the restricted-area arc under the rim (1.25 m)
  g.lineStyle(2, line, 0.8);
  floorArc(RIM.x, RIM.d, 1.25, Math.PI / 2, (Math.PI * 3) / 2);
  return g;
}

/**
 * The hoop's keep-out zone: red tint + diagonal hatching. Starts invisible;
 * CourtScene fades it in when the player walks up close (T.zone.showDistPx).
 */
export function createKeepOutZone(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const x1 = T.court.lengthM * M;
  const yTop = floorY(0);
  const yBot = floorY(T.court.depthM);
  const zoneX = (RIM.x - T.move.hoopStandoffM) * M;
  const g = scene.add.graphics().setDepth(-49).setAlpha(0);

  g.fillStyle(0xd94f3a, 0.14).fillRect(zoneX, yTop, x1 - zoneX, yBot - yTop);
  g.lineStyle(2, 0xd94f3a, 0.35);
  const zh = yBot - yTop;
  // 45° hatch: each line runs (hx, yBot) → (hx+zh, yTop), clipped to the zone
  for (let hx = zoneX - zh; hx < x1; hx += 18) {
    const xa = Math.max(hx, zoneX);
    const xb = Math.min(hx + zh, x1);
    if (xb <= xa) continue;
    g.beginPath();
    g.moveTo(xa, yBot - (xa - hx));
    g.lineTo(xb, yBot - (xb - hx));
    g.strokePath();
  }
  g.lineStyle(3, 0xd94f3a, 0.85);
  g.beginPath();
  g.moveTo(zoneX, yTop);
  g.lineTo(zoneX, yBot);
  g.strokePath();
  return g;
}

export interface HoopRimParts {
  id: string;
  net: Phaser.GameObjects.Graphics; // its own object so score juice can snap it
  rimSX: number; // rim center, world px
  rimSY: number;
}

export interface HoopParts {
  /** the CARRIAGE: backboard + rim strokes + tie arms - everything that
   *  rides the tier-4 vertical oscillation (setLift) */
  body: Phaser.GameObjects.Graphics;
  /** the part that never moves: the pole (foot/screen/shadow are their
   *  own objects) - split out so the carriage can ride alone */
  fixed: Phaser.GameObjects.Graphics;
  /** move the carriage (board + rims + nets) liftM meters up; the pole
   *  and foot stay. Keeps rims[].rimSX/rimSY fresh - score juice and
   *  the aim read them at effect time. */
  setLift(liftM: number): void;
  /** one per hittable rim, top-most first (mirrors geom.rims) */
  rims: HoopRimParts[];
  /** the rim juice targets by default - the lowest one */
  primary: HoopRimParts;
  shadow: Phaser.GameObjects.Ellipse; // live - the sun system steers it
  /** the foot contraption's screen: "current / required" toward the next
   *  upgrade, or current alone at the ladder's top (required = null) */
  setScoreDisplay(current: number, required: number | null): void;
  destroy(): void;
}

/** Tier 1's hoop paint - the fallback when no look is passed. */
const DEFAULT_HOOP_LOOK: HoopLook = {
  board: 0xf6ead2,
  boardEdge: 0x8a6a4a,
  rim: 0xe86a3a,
  pole: 0x6a6a72,
};

/** The pole's shaded arm/fitting colour, derived a step darker. */
function darken(c: number, f = 0.8): number {
  const r = Math.floor(((c >> 16) & 0xff) * f);
  const g = Math.floor(((c >> 8) & 0xff) * f);
  const b = Math.floor((c & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/**
 * Pole + backboard + every rim/net of the given tier geometry, in the
 * tier's paint job, standing at the right end of the court. Rebuilt on
 * upgrade (the tier director destroys the old parts and creates the new
 * ones, staged for choreo).
 *
 * `ghost` renders the SAME hoop as a half-alpha stand-in behind the
 * live one (a replay of a throw from another tier scores on the hoop
 * it was actually thrown at): no floor shadow, no foot screen - just
 * the structure and its nets, ready for the replay's net snap.
 */
export function createHoop(
  scene: Phaser.Scene,
  geom: HoopGeometry,
  look: HoopLook = DEFAULT_HOOP_LOOK,
  opts?: { ghost?: boolean; liftHeadroomM?: number },
): HoopParts {
  const baseY = floorY(RIM.d);
  const boardX = geom.boardX * M;
  const boardTop = baseY - geom.boardTopM * M;
  const boardBot = baseY - geom.boardBottomM * M;
  const boardW = 12;
  const lowest = geom.rims.reduce((a, b) => (a.h < b.h ? a : b));

  // floor shadow - its own object so it can track the moving suns
  const shadow = scene.add
    .ellipse(
      RIM.x * M + 8,
      baseY,
      lowest.r * M * 4,
      lowest.r * M * 0.7,
      0x000000,
      0.15,
    )
    .setDepth(sortDepth(RIM.d) - 1);

  const armColor = darken(look.pole);
  const housingR = 52;
  // FIXED half (drawn first = behind): the pole. The rest of the
  // structure lives on the carriage graphics so the tier-4 oscillation
  // can ride it up and down (setLift) while the pole stands.
  const fixed = scene.add.graphics().setDepth(sortDepth(RIM.d));
  const g = scene.add.graphics().setDepth(sortDepth(RIM.d));
  // pole (behind the board, down INTO the foot housing - the housing is
  // a separate lower-depth object, so the pole must stop at its crown).
  // A rim RAISED above the board (tier 3's lifted upper) needs the post
  // to keep climbing past the board top so its tie-arm has something to
  // hang from - "one post carrying two stacked rims". A MOVING hoop
  // (tier 4) adds liftHeadroomM so the carriage never rides off the top.
  const highestRimY = baseY - Math.max(...geom.rims.map((r) => r.h)) * M;
  const poleTop =
    Math.min(boardTop + 14, highestRimY - 2) - (opts?.liftHeadroomM ?? 0) * M;
  fixed.fillStyle(look.pole).fillRect(
    boardX + boardW + 2,
    poleTop,
    7,
    baseY - housingR + 6 - poleTop,
  );
  g.fillStyle(armColor).fillRect(boardX - 2, boardTop + 22, boardW + 8, 5); // arm
  // a POLE-COLOURED strut ties the raised top rim of a double hoop back
  // to the post, so the rim doesn't read as hovering (owner 2026-07-15).
  // Render-only - physics never sees it. Drawn BEFORE the board so the
  // board covers the stretch behind it.
  const strutRim = geom.rims.length > 1 ? geom.rims[0] : null;
  if (strutRim) {
    const y = baseY - strutRim.h * M;
    const back = (strutRim.x + strutRim.r) * M;
    const poleCx = boardX + boardW + 2 + 3.5; // the post's center line
    g.fillStyle(look.pole).fillRect(back, y - 2, poleCx - back, 5);
  }
  // backboard
  g.fillStyle(look.board).fillRect(boardX, boardTop, boardW, boardBot - boardTop);
  g.lineStyle(2, look.boardEdge).strokeRect(boardX, boardTop, boardW, boardBot - boardTop);

  // the score contraption at the pole's foot: a semicircular housing
  // wrapped around the pole base with a rectangular screen inside that
  // shows "current / required" toward the next upgrade - part of the
  // hoop itself, rebuilt (and repainted) with it every tier. Drawn just
  // BELOW the character/ball band at the rim lane, so anyone walking up
  // to the hoop (and any bouncing ball) covers the screen, not the
  // other way round.
  // PLACEHOLDER (tune): housing radius, screen size, font size.
  const footCx = boardX + boardW + 2 + 3.5; // pole center
  const foot = scene.add.graphics().setDepth(sortDepth(RIM.d) - 0.5);
  foot.fillStyle(armColor);
  foot.beginPath();
  foot.slice(footCx, baseY, housingR, Math.PI, Math.PI * 2);
  foot.fillPath();
  foot.lineStyle(2, look.boardEdge);
  foot.beginPath();
  foot.slice(footCx, baseY, housingR, Math.PI, Math.PI * 2);
  foot.strokePath();
  foot.fillStyle(0x101418).fillRect(footCx - 44, baseY - 28, 88, 22);
  foot.lineStyle(2, 0x2a3a44).strokeRect(footCx - 44, baseY - 28, 88, 22);
  const scoreText = scene.add
    .text(footCx, baseY - 17, "", {
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: "14px",
      fontStyle: "bold",
      color: "#ffd97a", // warm LED - clearly readable on the dark screen
    })
    .setOrigin(0.5)
    .setResolution(2)
    .setDepth(sortDepth(RIM.d) - 0.4);

  const rims: HoopRimParts[] = geom.rims.map((rim) => {
    const rimY = baseY - rim.h * M;
    const rimL = (rim.x - rim.r) * M;
    const rimR = (rim.x + rim.r) * M;
    // rim stroke on the shared body graphics
    g.lineStyle(5, look.rim);
    g.beginPath();
    g.moveTo(rimL, rimY);
    g.lineTo(rimR, rimY);
    g.strokePath();
    g.fillStyle(look.rim).fillCircle(rimL, rimY, 3); // front hook
    // an arm tying a protruding rim back to the board (the strutted top
    // rim already carries its pole strut - don't double-draw)
    if (rim !== strutRim && rim.x + rim.r + 4 < geom.boardX) {
      g.fillStyle(armColor).fillRect(rimR, rimY - 2, boardX - rimR, 4);
    }

    const net = scene.add.graphics().setDepth(sortDepth(RIM.d));
    net.setPosition(rim.x * M, rimY);
    const nw = rim.r * M - 2;
    const nh = Math.round(rim.r * M * 2);
    net.lineStyle(1, 0xfdf6e3, 0.9);
    for (const t of [-1, -0.33, 0.33, 1]) {
      net.beginPath();
      net.moveTo(t * nw, 0);
      net.lineTo(t * nw * 0.55, nh);
      net.strokePath();
    }
    net.beginPath();
    net.moveTo(-nw * 0.75, nh * 0.5);
    net.lineTo(nw * 0.75, nh * 0.5);
    net.strokePath();
    net.beginPath();
    net.moveTo(-nw * 0.55, nh);
    net.lineTo(nw * 0.55, nh);
    net.strokePath();

    return { id: rim.id, net, rimSX: rim.x * M, rimSY: rimY };
  });

  if (opts?.ghost) {
    // half-alpha structure BEHIND the live hoop; the dressing (shadow,
    // foot housing, score screen) stays built - HoopParts keeps one
    // shape - but hidden: a ghost casts no shadow and counts no score
    const a = T.ghost.alpha;
    shadow.setVisible(false);
    foot.setVisible(false);
    scoreText.setVisible(false);
    fixed.setAlpha(a).setDepth(sortDepth(RIM.d) - 2);
    g.setAlpha(a).setDepth(sortDepth(RIM.d) - 2);
    for (const r of rims) r.net.setAlpha(a).setDepth(sortDepth(RIM.d) - 2);
  }

  // the carriage ride needs each rim's REST screen height - rimSY is
  // mutated live by setLift (score juice reads it at effect time)
  const baseRimSY = rims.map((r) => r.rimSY);

  const primary = rims[geom.rims.indexOf(lowest)];
  return {
    body: g,
    fixed,
    rims,
    primary,
    shadow,
    setLift(liftM: number) {
      const dy = liftM * M;
      g.setY(-dy);
      rims.forEach((r, i) => {
        r.net.setY(baseRimSY[i] - dy);
        r.rimSY = baseRimSY[i] - dy;
      });
    },
    setScoreDisplay(current: number, required: number | null) {
      // threshold reached → the screen stops counting and celebrates:
      // stars instead of numbers, until the upgrade is pressed
      scoreText.setText(
        required === null
          ? `${current}`
          : current >= required
            ? "★ ★ ★"
            : `${current} / ${required}`,
      );
    },
    destroy() {
      fixed.destroy();
      g.destroy();
      foot.destroy();
      for (const r of rims) r.net.destroy();
      shadow.destroy();
      scoreText.destroy();
    },
  };
}
