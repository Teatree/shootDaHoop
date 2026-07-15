import Phaser from "phaser";
import { T } from "./tuning";
import { M, RIM, floorY, toScreen } from "./world";
import type { Player } from "./player";
import type { HoopGeometry } from "./shared/tierRules";

// Frames the bounding box of {hoop, player} + padding. Zoom is a function
// of their separation; pan and zoom are exponentially smoothed (never snap).
// The hoop bounds come from the ACTIVE tier's geometry (a getter), so an
// upgrade's taller hoop re-fits everyone's camera automatically.
export class CameraRig {
  private cx = 0;
  private cy = 0;
  private zoom = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
    private readonly geom: () => HoopGeometry,
  ) {
    const t = this.target();
    this.cx = t.cx;
    this.cy = t.cy;
    this.zoom = t.zoom;
    this.apply();
  }

  private target() {
    const cam = this.scene.cameras.main;
    const p = toScreen(this.player.x, this.player.d, this.player.airH);

    // hoop bounds: rim structure from floor to board top OR the highest
    // rim, whichever reaches higher (tier 3's raised upper rim sits well
    // above the board - the board no longer bounds the structure)
    const g = this.geom();
    const hoopMinX = Math.min(...g.rims.map((r) => (r.x - r.r) * M)) - 20;
    const hoopMaxX = g.boardX * M + 24;
    const hoopTopM = Math.max(g.boardTopM, ...g.rims.map((r) => r.h + 0.6));
    const hoopMinY = floorY(RIM.d) - hoopTopM * M - 10;

    const minX = Math.min(p.sx - 32, hoopMinX) - T.camera.padXPx;
    const maxX = Math.max(p.sx + 32, hoopMaxX) + T.camera.padXPx;
    const minY = Math.min(p.sy - 80, hoopMinY) - T.camera.padTopPx;
    const maxY =
      Math.max(p.sy, floorY(T.court.depthM)) + T.camera.padBottomPx;

    const visW = Math.max(maxX - minX, T.camera.minVisibleWidthM * M);
    const visH = maxY - minY;
    const zoom = Phaser.Math.Clamp(
      Math.min(cam.width / visW, cam.height / visH),
      T.camera.zoomMin,
      T.camera.zoomMax,
    );
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom };
  }

  update(dt: number) {
    const t = this.target();
    const kp = 1 - Math.exp(-T.camera.panLerp * dt);
    const kz = 1 - Math.exp(-T.camera.zoomLerp * dt);
    this.cx += (t.cx - this.cx) * kp;
    this.cy += (t.cy - this.cy) * kp;
    this.zoom += (t.zoom - this.zoom) * kz;
    this.apply();
  }

  private apply() {
    const cam = this.scene.cameras.main;
    cam.setZoom(this.zoom);
    cam.centerOn(this.cx, this.cy);
  }
}
