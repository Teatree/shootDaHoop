# /dance and the chat-command architecture

Built 2026-07-18 (owner ask). Typing `/dance` into the chat box makes
the character perform the "67" dance for ~6 seconds, visible to every
player in the court and captured into ghost recordings. This doc covers
the command plumbing (built to grow) and the dance itself.

## The command layer - src/commands.ts

Any chat submission starting with `/` is a COMMAND, not a message:

- `CourtScene`'s `hud.onChat` handler calls `runChatCommand(text, ctx)`
  first; when it returns true the text never reaches `backend.chat` -
  commands cannot leak into the court wall as messages.
- `REGISTRY` is the extension point: one entry per command with
  `{ name, hint, run(ctx, args) }`. `ctx` currently carries
  `{ player, hud }` - widen it (scene, backend...) when a future
  command needs more.
- Unknown commands answer locally with the command list, using each
  entry's `hint` - the registry documents itself.
- Case-insensitive on the name; everything after the name arrives as
  `args` (unused by /dance, ready for future commands).

### The design rule that keeps this cheap

Commands execute LOCALLY. Anything other players should see must ride
a system that already broadcasts. The dance needed zero new wire
format because it is A POSE - the ~12 Hz pose telemetry streams it,
remote avatars render it through the same `computePose`, the server's
`sanePose` allowlist (server/room.ts `POSE_KINDS`) just learns the new
kind, and ghost recordings sample it like any other frame. A future
command that can't be expressed through an existing broadcast channel
is the moment to add a real message type - not before.

## The dance itself

### Pose math - src/shared/pose.ts

`"dance"` is a first-class `PoseKind`. The choreography (the "67"
meme): arms extended out to the sides like a pair of scales, trading
heights on the beat ("six... seven..."), the body swaying side to side
at HALF the arm tempo, with a small bounce riding the swaps and a lean
following the sway. All positional (the pixel-art rule: no per-part
rotation), all driven by `s.t`:

- `DANCE_HZ` 1.9 - scale-swaps per second
- `DANCE_ARM_X/Y` - how far out and how high the arms sit
- `DANCE_ARM_SWING` - each pan's up/down travel
- `DANCE_SWAY_PX`, `DANCE_BOB_PX`, `DANCE_TILT` - body life

All PLACEHOLDER (tune) - adjust by eye. `src/pose.test.ts` pins the
contract, not pixels: over a full period the hands must trade heights
and the arms must stay extended to the sides.

### Player state - src/player.ts

`poseOverride` (previously `"cheer" | null`, owned by the cheer deck)
widened to include `"dance"`:

- `dance(durationS)` sets the override + a `danceUntil` deadline.
  Refused while cheering (the deck owns that pose) or while control is
  taken away (teleport flight).
- The override expires in `update()` when the deadline passes, and
  `stopDancing()` ends it EARLY from `walkTo`, `enterStance` (aiming)
  and `enterPoint` - any real action beats the show. `currentKind()`
  already gave overrides top priority below fall/lie, so the dance
  naturally loses to a teleport and survives idle jitter.
- Duration knob: `T.commands.danceDurationS` (tuning.ts, 6 s).

### What travels where

| Path | Mechanism | Work needed |
| --- | --- | --- |
| Other players see it | pose telemetry (`AvatarState.pose`) | server allowlist + one word |
| Ghost replays include it | `RecordingSystem` samples `visualState()` | none |
| Offline | LocalBackend streams nothing; the local rig renders the same pose | none |

## Adding the next command - checklist

1. Add the entry to `REGISTRY` in `src/commands.ts` (name, hint, run).
2. If it animates the character: new `PoseKind` + `computePose` case +
   `POSE_KINDS` on the server + a `pose.test.ts` contract + whatever
   Player state drives its clock. Follow the dance, it is the template.
3. If it needs a knob: `T.commands.*` in tuning.ts.
4. If it genuinely needs the server to ACT (not just see a pose): a new
   ClientMsg case - the first command to cross that line should also
   decide validation rules.
