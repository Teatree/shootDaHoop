# Asset drop zone

Put final art/sound files in this folder with these exact names. Anything
missing is covered by a generated placeholder — the game always runs.

## Images (PNG)

| File         | Size / notes                                                       |
| ------------ | ------------------------------------------------------------------ |
| `player.png` | 32 × 64. Facing **right**. Origin = bottom-center of the feet.     |
| `ball.png`   | ~10 × 10 (0.3 m at 32 px/m). Round; spin is applied in code.       |
| `court.png`  | Optional full-court floor art, 896 px wide (28 m × 32 px/m).       |
| `hoop.png`   | Optional composite hoop (pole + board + rim), rim at 3.05 m high.  |

> Shirt colour: the placeholder bakes a random session colour. If you supply
> `player.png` we'll either tint a white-shirt version or split the shirt to
> its own layer — flag which you prefer when the art lands.

## Audio (WAV)

| File             | Moment                          |
| ---------------- | ------------------------------- |
| `sfx_throw.wav`  | ball release                    |
| `sfx_bounce.wav` | ball hits the floor             |
| `sfx_rim.wav`    | rim / backboard clank           |
| `sfx_swish.wav`  | clean make (the big one)        |
| `sfx_score.wav`  | rattled-in make                 |
| `sfx_pop.wav`    | dead-ball explode               |
| `sfx_chat.wav`   | sending a chat line             |
