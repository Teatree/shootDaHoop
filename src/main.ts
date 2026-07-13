import Phaser from "phaser";
import { CourtScene } from "./scenes/CourtScene";
import { initHUD } from "./hud";
import { initSettings } from "./settings";
import { AUDIO_MANIFEST, IMAGE_MANIFEST, MUSIC_MANIFEST } from "./assets";
import { askPlayerName, getStoredName } from "./playerName";
import { LocalBackend } from "./backend/local";
import { SocketBackend } from "./backend/socket";
import type { Backend } from "./backend/types";
import {
  persistentHead,
  persistentLower,
  persistentShirt,
  persistentSkin,
} from "./placeholders";
import type { Cosmetics } from "./shared/messages";

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

/**
 * Who you are HERE. Name and look (shirt, skin, trousers, head) are
 * PER-LOBBY: the first time you enter a lobby you're asked a name and the
 * cosmetics are rolled; from then on that lobby — and only that lobby —
 * always shows you that way. Offline keeps one browser-global identity
 * (the original behaviour).
 */
async function resolveIdentity(lobby: string | null): Promise<Cosmetics> {
  const suffix = lobby ? `.${lobby}` : "";
  const nameKey = lobby ? `shootDaHoop.name.${lobby}` : undefined;
  return {
    name: getStoredName(nameKey) ?? (await askPlayerName(nameKey)),
    shirtColor: persistentShirt(`shootDaHoop.shirt${suffix}`),
    skinTint: persistentSkin(`shootDaHoop.skin${suffix}`),
    lowerTint: persistentLower(`shootDaHoop.lower${suffix}`),
    headVariant: persistentHead(`shootDaHoop.head${suffix}`),
  };
}

/** ?lobby=<id> joins that live world; no param plays offline. */
function chooseBackend(
  params: URLSearchParams,
  lobby: string | null,
  identity: Cosmetics,
): Backend {
  if (!lobby) return new LocalBackend(identity);
  return new SocketBackend({
    url: params.get("server") ?? `ws://${location.hostname}:9999`,
    lobby,
    identity: { id: params.get("pid") ?? devIdentity(), ...identity },
    // ?reset wipes the lobby's shared score on join (dev/owner tool)
    reset: params.has("reset"),
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
  initSettings();

  const params = new URLSearchParams(location.search);
  const lobby = params.get("lobby");

  // first visit (per lobby) asks; afterwards that court knows you
  const identity = await resolveIdentity(lobby);

  // one-shot: drop ?reset from the address bar so a refresh or a shared
  // link doesn't wipe the score again
  if (params.has("reset")) {
    const clean = new URLSearchParams(params);
    clean.delete("reset");
    const qs = clean.toString();
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
  }

  const images: string[] = [];
  const audio: string[] = [];
  const music: { key: string; url: string }[] = [];
  await Promise.all([
    ...IMAGE_MANIFEST.map(async (k) => {
      if (await exists(`assets/${k}.png`)) images.push(k);
    }),
    ...AUDIO_MANIFEST.map(async (k) => {
      if (await exists(`assets/${k}.wav`)) audio.push(k);
    }),
    ...MUSIC_MANIFEST.map(async (k) => {
      for (const ext of ["mp3", "wav"] as const) {
        const url = `assets/music/${k}.${ext}`;
        if (await exists(url)) {
          music.push({ key: k, url });
          return;
        }
      }
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
      new CourtScene(
        hud,
        { images, audio, music },
        identity,
        chooseBackend(params, lobby, identity),
      ),
    ],
  });
}

void boot();
