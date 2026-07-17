# Deploying to render.com

One render.com "Web Service" runs the whole game: `server/index.ts`
serves the built client over HTTP (server/web.ts) and speaks WebSocket
on the same port. The client, when it isn't on the vite dev server,
connects its socket to the page's own origin (main.ts) - so a deploy at
`https://shootdahoop.onrender.com` needs no config anywhere. Invite
links and the SHARE blurb mint from `location.origin`, so they
automatically read `https://shootdahoop.onrender.com/?lobby=...` on the
deployed site.

## Steps

1. Push the repo to GitHub (the owner pushes; nothing else pushes).
2. On https://render.com: **New > Web Service**, connect the GitHub
   repo.
3. Fill in the service:
   - **Name**: `shootdahoop` (this becomes shootdahoop.onrender.com)
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free works for trying it out (see caveats)
4. Environment variables (Environment tab):
   - `ADMIN_TOKEN` = a long random secret (the admin CLI's key; the
     default is "dev-admin" - do not ship that)
   - `DATA_DIR` = `/var/data` (only if you add a disk, step 5)
   - `ANALYTICS_URL` + `ANALYTICS_SECRET` = the Google Sheets analytics
     sink (optional - see docs/analytics.md; unset = analytics off)
   - `DATABASE_URL` = the Neon Postgres connection string (2026-07-17):
     worlds, profiles, the wall archive and ghost recordings all live
     there and SURVIVE free-tier spin-downs and deploys. Unset = JSON
     files on the ephemeral disk (dev behaviour; data dies with the
     container - the original lobby-wipe bug).
   - (`PORT` is set by render automatically; the server reads it)
5. **Persistence** (recommended once real players exist): profiles,
   world scores and the wall live as JSON files (server/storage.ts).
   - Free tier: the filesystem is EPHEMERAL - every deploy/restart
     wipes scores and budgets. Fine for a test run.
   - Paid instance: add a **Disk** (1 GB is plenty), mount path
     `/var/data`, and set `DATA_DIR=/var/data`. Data now survives.
   - (storage.ts is the swap point for Postgres later, as noted there.)
6. Deploy. When it's live, open `https://shootdahoop.onrender.com` -
   offline play works at the bare URL; the ⚙️ Settings invite link mints
   a lobby and anyone opening it lands in the same world.

## Caveats

- Free instances SPIN DOWN after ~15 min idle; the next visitor waits
  ~30-60 s for the wake-up. Live sockets keep it awake.
- The admin CLI reaches the deployed server with:
  `npm run admin -- list --server wss://shootdahoop.onrender.com --token <ADMIN_TOKEN>`
- Local production rehearsal: `npm run build`, then `npm run server`,
  then open http://localhost:9999 - that is exactly what render runs.

## What was changed for this (2026-07-17)

- server/web.ts: static server over `dist/` + og:meta injection via
  shared/shareMeta.ts (the link-preview progress), attached WebSocket.
- main.ts: socket default is `ws(s)://<page origin>` in production
  builds, `ws://localhost:9999` in dev (`import.meta.env.DEV`).
- package.json: `start` script; `tsx` moved to dependencies so the
  start command survives `NODE_ENV=production` installs.
