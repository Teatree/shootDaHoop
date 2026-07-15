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

> Status: working. All Stage 2 build steps of `MULTIPLAYER.md` are done and
> two-browser verified. Not yet done: cloud deploy (Render/Postgres) and the
> chat-bot invite flow; locally the server persists to JSON files in `data/`.

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

   Useful dev parameters: `?pid=<id>` forces a player identity (handy for two
   tabs in the same window, which otherwise share one), and `?server=<ws-url>`
   points at a non-default game server. Adding `&reset=1` **wipes the lobby's
   shared score** on join (one-shot: the param is removed from the address bar
   so a refresh doesn't wipe again; the reset is credited on the court wall).

   Your **name and shirt colour are per-lobby**: the first time you enter a
   lobby you're asked for a name and a colour is rolled; that lobby then
   always shows you that way. Another lobby asks again and remembers its own
   pair. (Stored per browser: `shootDaHoop.name.<lobby>` /
   `shootDaHoop.shirt.<lobby>` - so two tabs in one window share them even
   with different `?pid=`s.) Offline play keeps one browser-global name.

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

### Creating a lobby from the game

Click the **⚙️ gear button** next to Send and hit **Generate lobby link**.
That mints an invite URL for a fresh court (e.g. `?lobby=mossy-fox-3f2a`),
shown as a plain link in the pop-up. **Copy invite** puts a framed
plain-text invitation on the clipboard - a little poster naming the court
with the link inside, ready to paste into any chat - and **Join this
lobby** takes you there yourself. A generated link is just a link: nothing
exists on the server until someone opens it and enters a name - that first
join creates and persists the world. The link carries only `?server=` over
from your current address (`?pid=` and `?reset` are deliberately dropped).

## Admin: managing lobbies

Every joined lobby lives on as files under `data/` (`worlds/<lobby>.json`,
`logs/<lobby>.jsonl`). To decide which lobbies can go, list them:

```
npm run admin -- list
```

Columns: **lobby** id, **players** (distinct names that ever joined - names,
not identities), **hoop tier**, and **last visited** (the last player-caused
event in the lobby's log).

```
npm run admin -- remove <lobby>
```

Removal is a move, not a delete: the lobby's world and log go to
`data/backups/<lobby>/`. If the server is running, players currently in the
lobby are kicked first and see a "removed manually by the admin" notice; if
the server is down the kick is skipped and the files just move. Player
profiles are global (shared across lobbies) and are never touched. Note: the
old invite link still works - reopening it creates a *fresh* lobby with the
same id.

```
npm run admin -- restore <lobby>
```

Brings back all progress (shared score, hoop tier, full wall history). It
refuses if a lobby with that id already exists again (someone reused the old
link); `restore <lobby> --force` discards that re-created lobby - kicking
anyone in it - and brings the backup back.

```
npm run admin -- backups          # list what's in data/backups/
npm run admin -- purge-backup <lobby>   # the only true delete
```

Environment knobs: `ADMIN_TOKEN` (shared secret between server and CLI;
defaults to `dev-admin` - set a real one anywhere non-local), `ADMIN_SERVER`
(default `ws://localhost:9999`), `DATA_DIR` (default `data`).

## Tuning

- Client feel knobs (camera, aim preview, juice intensity, sky, ghosts,
  speech bubbles) live in `src/tuning.ts`. Edit and save, and Vite hot-reloads.
- Shared balance (gravity, power curve, scoring, throw budget, hoop tiers,
  ball types) lives in `src/shared/config.ts` and its sibling data files,
  which the server will import too.

Final art and sound go in `public/assets/`. See the README there for the
file manifest; missing assets fall back to generated placeholders.
