# First-entry controls pop-up & media processing — 2026-07-15

Two owner asks landed together: a controls pop-up for brand-new players,
and the game's first REAL media assets (tutorial clips + jukebox tracks),
which both needed processing before use. This doc records how and why.

## The controls pop-up (`src/controlsPopup.ts`)

- Shows ONCE per browser (`shootDaHoop.controlsSeen` in localStorage):
  two looping videos side by side — Walking, then Throwing — each above
  a pure-CSS animated mouse. Walk gets a plain LEFT CLICK loop; throw
  gets CLICK-AND-HOLD (press, long hold, release). Keyframes live in
  `style.css` (`tutClick` / `tutHold`).
- **Only the ✕ closes it** — no outside-click, no Escape (deliberate,
  unlike the settings modal).
- **The held join.** Until the ✕ is pressed the character exists for
  NOBODY: `backend.connect()` — the join that spawns the character on
  every screen — waits inside the close callback, and the local rig +
  shadow + name tag are hidden too (`Player.setVisible(false)`). Both
  halves matter: deferring connect alone still left the local character
  visible on the player's own court.

## Tutorial clips (`public/assets/tutorial/tut_{walk,throw}.webm`)

- Sources: the owner's `tut_vid_walk.mp4` (232×234) and
  `tut_vid_throw.mp4` (204×230), both 4.3 s.
- Cropped to EXACTLY the same frame per the owner's priority — the walk
  clip braver, the throw clip gently (it needs its top for the ball's
  arc): both to **200×220**, walk at offset (16,10), throw at (2,2).
  Crops were chosen by extracting frames (`ffmpeg -vf "select=eq(n\,N)"`)
  and LOOKING at them — the walk clip's cursor swings to x≈178, so a
  symmetric 16 px side-crop keeps it in frame.
- Format shoot-out at the same crop: **VP9/webm ~28 KB** vs animated
  webp ~222 KB (8×) vs source h264 ~65 KB. WebM wins decisively for
  video content; `<video autoplay loop muted playsinline>` plays it.
  Encode: `-c:v libvpx-vp9 -b:v 0 -crf 36 -an -pix_fmt yuv420p`.

## Jukebox tracks (`public/assets/music/song1..3.ogg`)

- Sources: three mp3 mixes in the repo root — **78, 53 and 112 MINUTES**
  (223 MB total at 128 kbps). Converted with `-c:a libopus -b:a 64k` →
  110 MB total, comparable listening quality. The asset probe
  (`main.ts`) now checks `.ogg` before `.mp3`/`.wav`.
- **The decode blowup.** Phaser's WebAudioSoundManager loads audio via
  `decodeAudioData`, which expands a track to raw PCM: an hour-long mix
  becomes **gigabytes of RAM** (song3, 112 min, flatly refused with
  "Unable to decode audio data"). Never `this.load.audio()` long music.
- The jukebox now streams a plain **HTMLAudioElement**: starts within
  moments, `currentTime` seeks to the authoritative elapsed position
  (the ends-for-everyone-together sync), keeps playing on a blurred tab
  (spec behaviour — Phaser's clock pause never touches it).
- The bass-pulse analyser taps the element with
  `createMediaElementSource`, which REROUTES its output through the
  context — so only tap when `context.state === "running"`; a suspended
  context would silence the song (the fixed-tempo fallback pulse covers
  that case). Autoplay-blocked adoption (rejoining mid-song before any
  input) retries once on the first pointer/key gesture.
- The raw mp3/mp4 sources stay untracked in the repo root — the game
  only ships the processed files.
