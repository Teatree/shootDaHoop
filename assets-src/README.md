# assets-src - raw source material

Source files that the shipped assets were made from. Nothing in here is
loaded by the game; the processed versions live in `public/assets/`.

| Source | Shipped as |
|---|---|
| `track_1_boombap.mp3` | `public/assets/music/song1.ogg` |
| `track_2_80s_breakdance.mp3` | `public/assets/music/song2.ogg` |
| `track_3_g_funk.mp3` | `public/assets/music/song3.ogg` |
| `tut_vid_walk.mp4` | `public/assets/tutorial/tut_walk.webm` |
| `tut_vid_throw.mp4` | `public/assets/tutorial/tut_throw.webm` |
| `PlayerCharacter.psd`, `guy.png`, `char_image_and_plan.png` | character rig parts in `public/assets/` (see `docs/character-rig.md`) |
| `bb_ornith.html` | reference implementation for the aim trajectory (see `docs/gameplay-prototype.md`) |

Raw audio/video (`*.mp3`, `*.mp4`) is gitignored - only processed files
ship. Safe to delete locally if you need the disk space back.
