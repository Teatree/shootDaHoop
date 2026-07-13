// Optional user-provided asset keys (files live in public/assets/…).
// Missing files are fine — generated placeholders cover them.
// See public/assets/README.md for the manifest with sizes.

export const IMAGE_MANIFEST = [
  "ball",
  "court",
  "hoop",
  // character rig parts (see characterRig.ts) — tinted at runtime:
  // heads+hands share a skin tint, body_upper takes the shirt colour,
  // body_lower gets a subtle trouser tint
  "head_v1",
  "head_v2",
  "head_v3",
  "body_upper",
  "body_lower",
  "left_hand",
  "right_hand",
] as const;

export const AUDIO_MANIFEST = [
  "sfx_throw",
  "sfx_bounce",
  "sfx_rim",
  "sfx_swish",
  "sfx_score",
  "sfx_pop",
  "sfx_chat",
] as const;

// Jukebox song slots (Hoop 3): drop files at public/assets/music/
// song1.mp3 (or .wav) … — the jukebox works without them (the song
// choice still syncs to everyone; missing files just play silence).
export const MUSIC_MANIFEST = ["song1", "song2", "song3"] as const;

export interface AvailableAssets {
  images: string[];
  audio: string[];
  /** jukebox songs found on disk, key + resolved url (may be empty) */
  music: { key: string; url: string }[];
}
