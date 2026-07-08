# shootDaHoop

A cozy basketball hangout: walk the court, charge up throws, chase the
teleport orb, chat, and replay any shot from the court-wall log. Built with
Phaser 3 + Vite + TypeScript, all rendering generated in code.

See `Gameplay_Spec.md` for the original spec, `MULTIPLAYER.md` for the
multiplayer spec and build status, and `docs/` for feature deep dives.

## Run (single player)

```
npm install
npm run dev
```

Open the printed localhost URL. First visit asks for your name; it is
remembered in localStorage.

## Controls

- **Left-click**: walk to the clicked spot (moves along the court and in depth)
- **Right-click + hold**: aim at the cursor, then **drag out** to charge power.
  The dotted line is the power meter: longer and hotter means a harder throw,
  and a pulsing ring at the end means you are at maximum power.
- **Release right-click**: throw
- **Enter**: chat (messages appear as a speech bubble and in the court-wall log)
- **Click a throw line in the log**: replay that shot as a ghost recording
- **Hit the blue orb with a ball**: teleport up to it for a 500-point slam window

## Testing

Unit tests cover the shared simulation (throw physics, scoring, the server
resolver) and run in under a second:

```
npm test
```

## Testing multiplayer

> Status: the multiplayer server is Stage 2 of `MULTIPLAYER.md` and is not
> built yet. Stage 1 (the Backend seam and the shared simulation module) is
> done, and single player runs through `LocalBackend`. The steps below are
> the procedure once the server lands; this section will be updated as each
> build step ships.

1. Start the game server (Node + WebSocket) and the client dev server:

   ```
   npm run server
   npm run dev
   ```

2. Open the game in **two separate browser windows** (or one normal and one
   incognito window, so each gets its own identity) with the **same lobby id**:

   ```
   http://localhost:5173/?lobby=test-court
   ```

3. What to check:
   - Both windows show both avatars; walking in one window animates in the other.
   - A throw in one window renders in both, and the score (shared between all
     players in the world) updates everywhere from the server's outcome.
   - Chat from either window reaches both logs; closing a window logs a leave
     line in the other and removes the avatar.
   - Rejoining the same `?lobby=` id restores the world (shared score, hoop
     tier) and your profile: progress is persistent, presence is not.
   - The throw budget (5 per day) is enforced by the server: after the fifth
     throw the server rejects further attempts even if the client is modified.

Different `?lobby=` values are different worlds; a window with no `?lobby=`
parameter plays offline through `LocalBackend`.

## Tuning

- Client feel knobs (camera, aim preview, juice intensity, sky, ghosts,
  speech bubbles) live in `src/tuning.ts`. Edit and save, and Vite hot-reloads.
- Shared balance (gravity, power curve, scoring, throw budget, hoop tiers,
  ball types) lives in `src/shared/config.ts` and its sibling data files,
  which the server will import too.

Final art and sound go in `public/assets/`. See the README there for the
file manifest; missing assets fall back to generated placeholders.
