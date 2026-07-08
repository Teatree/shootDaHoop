import Phaser from "phaser";
import { CourtScene } from "./scenes/CourtScene";
import { initHUD } from "./hud";
import { AUDIO_MANIFEST, IMAGE_MANIFEST } from "./assets";
import { askPlayerName, getStoredName } from "./playerName";
import { LocalBackend } from "./backend/local";
import { SocketBackend } from "./backend/socket";
import type { Backend } from "./backend/types";
import { SESSION_SHIRT } from "./placeholders";

/** Stable per-browser identity for dev; the bot platform id replaces this. */
function devIdentity(): string {
  const KEY = "shootDaHoop.pid";
  let pid = localStorage.getItem(KEY);
  if (!pid) {
    pid = `p-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, pid);
  }
  return pid;
}

/** ?lobby=<id> joins that live world; no param plays offline. */
function chooseBackend(playerName: string): Backend {
  const params = new URLSearchParams(location.search);
  const lobby = params.get("lobby");
  const identity = { name: playerName, shirtColor: SESSION_SHIRT };
  if (!lobby) return new LocalBackend(identity);
  return new SocketBackend({
    url: params.get("server") ?? `ws://${location.hostname}:8787`,
    lobby,
    identity: { id: params.get("pid") ?? devIdentity(), ...identity },
  });
}

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
    scene: [
      new CourtScene(hud, { images, audio }, playerName, chooseBackend(playerName)),
    ],
  });
}

void boot();
