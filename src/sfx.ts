import Phaser from "phaser";

// Sound hooks. Real audio files are user-provided (see public/assets/README.md);
// until a file exists in the cache each call is a silent no-op.
export function playSfx(scene: Phaser.Scene, key: string, volume = 1) {
  if (scene.cache.audio.exists(key)) {
    scene.sound.play(key, { volume });
  }
}
