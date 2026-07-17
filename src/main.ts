import Phaser from "phaser";
import { CourtScene } from "./scenes/CourtScene";
import { initHUD } from "./hud";
import { initSettings } from "./settings";
import { AUDIO_MANIFEST, IMAGE_MANIFEST, MUSIC_MANIFEST } from "./assets";
import { askPlayerName, getStoredName } from "./playerName";
import { initShare } from "./share";
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
 * cosmetics are rolled; from then on that lobby - and only that lobby -
 * always shows you that way. Offline keeps one browser-global identity
 * (the original behaviour).
 */
async function resolveIdentity(
  lobby: string | null,
): Promise<{ identity: Cosmetics; freshName: boolean }> {
  const suffix = lobby ? `.${lobby}` : "";
  const nameKey = lobby ? `shootDaHoop.name.${lobby}` : undefined;
  // no stored name = a first entry into this court → the name modal runs,
  // and the controls pop-up follows it (owner ask 2026-07-16: the
  // tutorial appears right after the name was chosen)
  const stored = getStoredName(nameKey);
  return {
    identity: {
      name: stored ?? (await askPlayerName(nameKey)),
      shirtColor: persistentShirt(`shootDaHoop.shirt${suffix}`),
      skinTint: persistentSkin(`shootDaHoop.skin${suffix}`),
      lowerTint: persistentLower(`shootDaHoop.lower${suffix}`),
      headVariant: persistentHead(`shootDaHoop.head${suffix}`),
    },
    freshName: stored === null,
  };
}

/** ?lobby=<id> joins that live world; no param plays offline. */
function chooseBackend(
  params: URLSearchParams,
  lobby: string | null,
  identity: Cosmetics,
): Backend {
  if (!lobby) return new LocalBackend(identity);
  // dev: vite serves the page, the relay lives on :9999. Deployed
  // (shootdahoop.onrender.com): ONE server serves page + WebSocket, so
  // the socket is simply the page's own origin - links minted anywhere
  // (Settings invite, SHARE) carry location.origin and just work.
  const defaultUrl = import.meta.env.DEV
    ? `ws://${location.hostname}:9999`
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  return new SocketBackend({
    url: params.get("server") ?? defaultUrl,
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
  const share = initShare(lobby);

  // first visit (per lobby) asks; afterwards that court knows you
  const { identity, freshName } = await resolveIdentity(lobby);

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
      if (await exists(`assets/${k}.webp`)) images.push(k);
    }),
    ...AUDIO_MANIFEST.map(async (k) => {
      if (await exists(`assets/${k}.wav`)) audio.push(k);
    }),
    ...MUSIC_MANIFEST.map(async (k) => {
      // ogg first - the provided tracks ship as Opus (~half the mp3 weight,
      // players stream these while playing)
      for (const ext of ["ogg", "mp3", "wav"] as const) {
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
        lobby,
        freshName, // just chose a name → the controls pop-up follows
        share,
      ),
    ],
  });
}

void boot();
