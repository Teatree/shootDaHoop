// Optional user-provided asset keys (files live in public/assets/…).
// Missing files are fine — generated placeholders cover them.
// See public/assets/README.md for the manifest with sizes.

export const IMAGE_MANIFEST = ["player", "ball", "court", "hoop"] as const;

export const AUDIO_MANIFEST = [
  "sfx_throw",
  "sfx_bounce",
  "sfx_rim",
  "sfx_swish",
  "sfx_score",
  "sfx_pop",
  "sfx_chat",
] as const;

export interface AvailableAssets {
  images: string[];
  audio: string[];
}
