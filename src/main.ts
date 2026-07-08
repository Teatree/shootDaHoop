import Phaser from "phaser";
import { CourtScene } from "./scenes/CourtScene";
import { initHUD } from "./hud";
import { AUDIO_MANIFEST, IMAGE_MANIFEST } from "./assets";
import { askPlayerName, getStoredName } from "./playerName";

// Probe which user-provided assets actually exist (the dev server answers
// missing files with the index.html fallback, which Phaser can't decode).
async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const type = res.headers.get("content-type") ?? "";
    return res.ok && !type.includes("text/html");
  } catch {
    return false;
  }
}

async function boot() {
  const hud = initHUD();

  // first visit asks; afterwards the court knows you
  const playerName = getStoredName() ?? (await askPlayerName());

  const images: string[] = [];
  const audio: string[] = [];
  await Promise.all([
    ...IMAGE_MANIFEST.map(async (k) => {
      if (await exists(`assets/${k}.png`)) images.push(k);
    }),
    ...AUDIO_MANIFEST.map(async (k) => {
      if (await exists(`assets/${k}.wav`)) audio.push(k);
    }),
  ]);

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game-container",
    backgroundColor: "#f9e3b8",
    // pixel-perfect path: nearest-neighbour, no smoothing, no sub-pixel jitter
    pixelArt: true,
    roundPixels: true,
    disableContextMenu: true, // right-click is the aim button
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [new CourtScene(hud, { images, audio }, playerName)],
  });
}

void boot();
