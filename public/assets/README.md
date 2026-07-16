# Asset drop zone

Put final art/sound files in this folder with these exact names. Anything
missing is covered by a generated placeholder - the game always runs.

## Images (PNG)

| File             | Size / notes                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `head_v1.png`    | 26 × 25 head variant (bald). Drawn facing **right**.               |
| `head_v2.png`    | 28 × 29 head variant (haired).                                     |
| `head_v3.png`    | 25 × 25 head variant (plain).                                      |
| `body_upper.png` | 43 × 36 white t-shirt torso - hard-tinted to the shirt colour.     |
| `body_lower.png` | 43 × 12 trouser band - subtle tint only.                           |
| `left_hand.png`  | 13 × 14 hand circle (drawn behind the body).                       |
| `right_hand.png` | 13 × 14 hand circle (drawn in front of the body).                  |
| `ball.png`       | ~10 × 10 (0.3 m at 32 px/m). Round; spin is applied in code.       |
| `court.png`      | Optional full-court floor art, 896 px wide (28 m × 32 px/m).       |
| `hoop.png`       | Optional composite hoop (pole + board + rim), rim at 3.05 m high.  |

> The character is composed from the part files at runtime (characterRig.ts):
> heads + hands share one skin tint (white→brown ramp - draw them pale so a
> multiply tint can tan them), `body_upper` is drawn WHITE so a hard tint
> becomes the exact shirt colour, `body_lower` keeps its own colour and only
> gets a gentle shade variation. `assets-src/guy.png` shows the intended
> assembly. A legacy single-sprite `player.png` is no longer used.

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
