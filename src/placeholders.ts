import Phaser from "phaser";
import { T } from "./tuning";
import {
  M,
  RIM,
  THREE_PT_X,
  FREE_THROW_X,
  WALL_LEFT_X,
  WALL_RIGHT_X,
  floorY,
  sortDepth,
} from "./world";

// Placeholder pixel art, generated at boot. Any texture the user supplies
// in public/assets/ (see the README there) takes priority — we only
// generate a stand-in when the key is missing from the texture cache.

const SHIRT_COLOURS = [
  0xd96a6a, 0x6a9ad9, 0x6ac48a, 0xd9b56a, 0xa97ad9, 0xd97ab0, 0x7ac4c4,
];

/**
 * The player's shirt colour — their visual identity. Rolled once, then
 * persistent per browser so what teammates see matches every session
 * (the server profile stores the same colour).
 */
function persistentShirt(): number {
  const KEY = "shootDaHoop.shirt";
  const stored = localStorage.getItem(KEY);
  if (stored) {
    const n = parseInt(stored, 16);
    if (SHIRT_COLOURS.includes(n)) return n;
  }
  const c = SHIRT_COLOURS[Math.floor(Math.random() * SHIRT_COLOURS.length)];
  localStorage.setItem(KEY, c.toString(16));
  return c;
}

export const SESSION_SHIRT = persistentShirt();

export function ensurePlaceholderTextures(scene: Phaser.Scene) {
  const tex = scene.textures;

  // 3×3 white square — particle building block
  if (!tex.exists("px")) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff).fillRect(0, 0, 3, 3);
    g.generateTexture("px", 3, 3);
    g.destroy();
  }

  // Ball — orange circle with a seam, generated at its on-screen size so
  // the pixelArt upscale doesn't turn it to mush (display-sized in Ball)
  if (!tex.exists("ball")) {
    const px = Math.max(10, Math.round(T.throw.ballRadiusM * 2 * M));
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

  // Character — the local player's texture, session shirt colour baked in.
  // Remote avatars get their own colour via ensurePlayerTexture below.
  if (!tex.exists("player")) {
    drawPlayerTexture(scene, "player", SESSION_SHIRT);
  }
}

/**
 * A player texture for any shirt colour (remote avatars) — generated once
 * per colour and cached in the texture manager. Returns the texture key.
 */
export function ensurePlayerTexture(
  scene: Phaser.Scene,
  shirtColor: number,
): string {
  const key = `player-${shirtColor.toString(16).padStart(6, "0")}`;
  if (!scene.textures.exists(key)) drawPlayerTexture(scene, key, shirtColor);
  return key;
}

/** 34×66 cozy figure with a 1px black outline and the given shirt colour. */
function drawPlayerTexture(scene: Phaser.Scene, key: string, shirt: number) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const skin = 0xe8b88a;
  const shorts = 0x4a4a5a;
  const shoes = 0x8a5a3a;
  // every body rect; mono=true paints them all black for the outline pass
  const figure = (ox: number, oy: number, mono: boolean) => {
    const c = (col: number) => (mono ? 0x000000 : col);
    // head + hair
    g.fillStyle(c(skin)).fillRect(ox + 10, oy + 2, 12, 12);
    g.fillStyle(c(0x5a3d28)).fillRect(ox + 10, oy + 0, 12, 4);
    // shirt + arms
    g.fillStyle(c(shirt)).fillRect(ox + 8, oy + 14, 16, 20);
    g.fillStyle(c(skin)).fillRect(ox + 4, oy + 14, 4, 14);
    g.fillStyle(c(skin)).fillRect(ox + 24, oy + 14, 4, 14);
    // shorts + legs + shoes
    g.fillStyle(c(shorts)).fillRect(ox + 8, oy + 34, 16, 10);
    g.fillStyle(c(skin)).fillRect(ox + 10, oy + 44, 5, 14);
    g.fillStyle(c(skin)).fillRect(ox + 17, oy + 44, 5, 14);
    g.fillStyle(c(shoes)).fillRect(ox + 9, oy + 58, 7, 6);
    g.fillStyle(c(shoes)).fillRect(ox + 16, oy + 58, 7, 6);
  };
  // black silhouette at 4 offsets = 1px outline, then the figure on top
  figure(0, 1, true);
  figure(2, 1, true);
  figure(1, 0, true);
  figure(1, 2, true);
  figure(1, 1, false);
  g.fillStyle(0x2b2b2b).fillRect(1 + 18, 1 + 6, 2, 2); // eye (faces right)
  g.generateTexture(key, 34, 66);
  g.destroy();
}

/** Desert backdrop: banded sky over rolling dunes. Suns live in sky.ts. */
export function drawBackdrop(scene: Phaser.Scene) {
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

  // rolling dunes — three rows of overlapping mounds straddling the horizon,
  // drawn once (static silhouettes; only the suns move)
  const dunes = scene.add.graphics().setDepth(-90);
  const rows: { tint: number; rise: number; rx: number; ry: number }[] = [
    { tint: 0xdfb877, rise: 26, rx: 340, ry: 70 }, // far, palest
    { tint: 0xd0a25e, rise: 14, rx: 260, ry: 55 }, // mid
    { tint: 0xc08e4c, rise: 4, rx: 200, ry: 45 }, //  near, deepest
  ];
  rows.forEach((row, ri) => {
    dunes.fillStyle(row.tint);
    const spacing = row.rx * 1.15;
    // phase each row so crests interleave instead of stacking
    for (let x = left + ri * spacing * 0.45; x < right; x += spacing) {
      dunes.fillEllipse(x, horizon - row.rise + row.ry / 2, row.rx * 2, row.ry * 2);
    }
  });
  // sand shelf that closes the dune bases at the horizon line
  dunes.fillStyle(0xc08e4c).fillRect(left, horizon - 4, w, 4);

  // sand the court sits on
  scene.add
    .rectangle(left, horizon, w, 900, 0xd4a86a)
    .setOrigin(0, 0)
    .setDepth(-80);
}

/**
 * Boundary walls past both baselines — sandstone, physical obstacles the
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

/** The court floor band with its painted lines. */
export function drawCourt(scene: Phaser.Scene) {
  const x0 = 0;
  const x1 = T.court.lengthM * M;
  const yTop = floorY(0);
  const yBot = floorY(T.court.depthM);
  const g = scene.add.graphics().setDepth(-50);

  // wood planks (alternating meter stripes)
  for (let m = 0; m < T.court.lengthM; m++) {
    g.fillStyle(m % 2 === 0 ? 0xc98d5a : 0xbd8250);
    g.fillRect(x0 + m * M, yTop, M, yBot - yTop);
  }
  // front lip (court edge facing the viewer)
  g.fillStyle(0x8a5a34).fillRect(x0, yBot, x1 - x0, 8);

  // painted lines
  const line = 0xf3e2c0;
  g.lineStyle(3, line, 0.9);
  g.strokeRect(x0 + 1, yTop + 1, x1 - x0 - 2, yBot - yTop - 2); // boundary

  const vline = (xm: number, alpha = 0.9) => {
    g.lineStyle(3, line, alpha);
    g.beginPath();
    g.moveTo(xm * M, yTop);
    g.lineTo(xm * M, yBot);
    g.strokePath();
  };
  vline(T.court.lengthM / 2, 0.7); // half-court
  vline(THREE_PT_X); //               3-point line
  vline(FREE_THROW_X, 0.7); //        free-throw line

  // free-throw spot marker (spawn)
  g.fillStyle(line, 0.9).fillCircle(FREE_THROW_X * M, floorY(RIM.d), 4);
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

export interface HoopParts {
  net: Phaser.GameObjects.Graphics;
  shadow: Phaser.GameObjects.Ellipse; // live — the sun system steers it
  rimSX: number; // rim center, world px
  rimSY: number;
}

/** Pole + backboard + rim + net, standing at the right end of the court. */
export function createHoop(scene: Phaser.Scene): HoopParts {
  const baseY = floorY(RIM.d);
  const rimY = baseY - RIM.h * M;
  const rimL = (RIM.x - RIM.r) * M;
  const rimR = (RIM.x + RIM.r) * M;
  const boardX = (RIM.x + RIM.r + T.hoop.boardGapM) * M;
  const boardTop = baseY - T.hoop.boardTopM * M;
  const boardBot = baseY - T.hoop.boardBottomM * M;
  const boardW = 12;

  // floor shadow — its own object so it can track the moving suns
  const shadow = scene.add
    .ellipse(RIM.x * M + 8, baseY, RIM.r * M * 4, RIM.r * M * 0.7, 0x000000, 0.15)
    .setDepth(sortDepth(RIM.d) - 1);

  const g = scene.add.graphics().setDepth(sortDepth(RIM.d));
  // pole (behind the board, down to the floor)
  g.fillStyle(0x6a6a72).fillRect(boardX + boardW + 2, boardTop + 14, 7, baseY - boardTop - 14);
  g.fillStyle(0x55555c).fillRect(boardX - 2, boardTop + 22, boardW + 8, 5); // arm
  // backboard
  g.fillStyle(0xf6ead2).fillRect(boardX, boardTop, boardW, boardBot - boardTop);
  g.lineStyle(2, 0x8a6a4a).strokeRect(boardX, boardTop, boardW, boardBot - boardTop);
  // rim
  g.lineStyle(5, 0xe86a3a);
  g.beginPath();
  g.moveTo(rimL, rimY);
  g.lineTo(rimR, rimY);
  g.strokePath();
  g.fillStyle(0xe86a3a).fillCircle(rimL, rimY, 3); // front hook

  // net — its own object so score juice can snap it
  const net = scene.add.graphics().setDepth(sortDepth(RIM.d));
  net.setPosition(RIM.x * M, rimY);
  const nw = RIM.r * M - 2;
  const nh = Math.round(RIM.r * M * 2);
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

  return { net, shadow, rimSX: RIM.x * M, rimSY: rimY };
}
