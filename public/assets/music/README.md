# Jukebox songs (Hoop 3)

Drop the three reference songs here as:

- `song1.mp3` (or `.wav`)
- `song2.mp3` (or `.wav`)
- `song3.mp3` (or `.wav`)

No code change needed - the game probes these slots at boot. Missing
files are fine: the jukebox still works (the song choice syncs to
everyone in the world), it just plays silence for that slot.

Loops: each file is played on a loop; late joiners seek into the loop
based on when it was started, so everyone hears roughly the same beat.
