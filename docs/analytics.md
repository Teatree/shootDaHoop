# Analytics -> Google Sheets

Product analytics for shootDaHoop, delivered as rows appended to one
Google Spreadsheet through a Google Apps Script web app. Built
2026-07-17.

## Design in one paragraph

The game server is the only real emitter (`server/analytics.ts`): every
meaningful player action already flows through it, the shared secret
never ships in the client bundle, and ad blockers never see a beacon.
Events queue in memory and flush in batches (30 s cadence, or instantly
at 50 rows); a failed POST drops the batch with a log line - analytics
must never become a gameplay problem. The two DOM-only moments the
server can't see (SHARE pressed, invite minted) arrive as a tiny
`POST /a` beacon that `server/web.ts` forwards into the same queue -
in dev, vite has no `/a` route, so dev sessions stay untracked, which
is the desired behaviour. The energy budget (cap 5, one ball per 10
minutes since 2026-07-18) still caps volume comfortably: a player
grinding a full hour makes ~11 throws; 200 casual dailies stay in the
low thousands of throw rows/day, far inside Apps Script's quotas.

## The tabs

Every row leads with `ts` (ISO timestamp), `lobby`, `pid`, so tabs stay
cross-referenceable.

| Tab           | Columns after the prefix                        | One row per                                   |
| ------------- | ----------------------------------------------- | --------------------------------------------- |
| `sessions`    | event(join/leave), name, is_new, session_s, throws | join and leave                              |
| `throws`      | dist_m, outcome(miss/hit/swish), points, rims, tier, balls_left | resolved throw                  |
| `progression` | event, tier, players                            | tier_unlock / upgrade_rejected_* / score_reset |
| `growth`      | event                                           | invite_opened, first_throw, share_clicked, invite_generated |
| `features`    | feature, action, value                          | catch, orb teleport, jukebox press, chat line (length only, never content) |
| `ops`         | event, detail                                   | server_boot, join_rejected_full               |

Two metrics these are designed to answer:

- **Refill return rate**: players whose `throws.balls_left` hit 0
  yesterday vs their `sessions.join` today - does the daily budget pull
  people back?
- **Invite conversion**: `growth` invite_generated -> invite_opened ->
  first_throw. `invite_opened` fires when a profile the storage has
  never seen joins a lobby - and lobby joins only happen through links,
  so it doubles as "name card completed after opening an invite".

## Google-side setup (step by step)

1. Create a Google Spreadsheet (sheets.google.com), name it e.g.
   `shootDaHoop analytics`.
2. **Extensions > Apps Script**. Delete the placeholder and paste the
   whole script from the section below.
3. Change `SECRET` at the top to a long random string.
4. Run the `setup` function once (toolbar: pick `setup`, press Run).
   Google asks for authorization - allow it. This mints the six tabs
   with bold, frozen header rows, and EVERY HEADER CELL CARRIES A NOTE
   explaining its column (hover any header to read it).
5. **Deploy > New deployment > type: Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (the secret in the payload is the gate;
     Apps Script cannot read custom headers)
   - Deploy, then copy the **Web app URL** (ends in `/exec`).
6. Wire the server (render.com dashboard > Environment, or locally):
   - `ANALYTICS_URL` = the `/exec` URL
   - `ANALYTICS_SECRET` = the same string as `SECRET` in the script
   - No `ANALYTICS_URL` = analytics silently off (dev default).
7. Smoke-test from a shell:

   ```
   curl -L -X POST "<ANALYTICS_URL>" -d '{"secret":"<SECRET>","events":[{"sheet":"ops","row":["2026-07-17T12:00:00Z","","","smoke_test",""]}]}'
   ```

   `-L` matters: Apps Script answers with a 302 to the response body.
   The row should appear on the `ops` tab within a second or two.

Editing the script later? A plain save is NOT live - use
**Deploy > Manage deployments > edit (pencil) > Version: New version**.

## The Apps Script

```javascript
// shootDaHoop analytics sink. doPost appends batched rows; setup()
// mints the tabs with noted headers. Payload shape (server/analytics.ts):
//   { secret: "...", events: [{ sheet: "throws", row: [ts, lobby, pid, ...] }] }
const SECRET = 'CHANGE-ME-TO-A-LONG-RANDOM-STRING';

// One entry per tab: header row + the note attached to each header cell.
const SHEETS = {
  sessions: {
    headers: ['ts', 'lobby', 'pid', 'event', 'name', 'is_new', 'session_s', 'throws'],
    notes: [
      'Event time, ISO 8601 UTC',
      'Lobby id (adjective-noun-hex). Empty = not lobby-scoped.',
      'Player id (per-browser). Empty = unknown/not applicable.',
      'join or leave',
      'Display name at the time',
      '1 = first time this player was ever seen (fresh profile), 0 = returning. Join rows only.',
      'Seconds between join and leave. Leave rows only.',
      'Throws made during this session. Leave rows only.',
    ],
  },
  throws: {
    headers: ['ts', 'lobby', 'pid', 'dist_m', 'outcome', 'points', 'rims', 'tier', 'balls_left'],
    notes: [
      'Event time, ISO 8601 UTC',
      'Lobby id',
      'Player id',
      'Shot distance in court meters, 2 decimals',
      'miss, hit (rattled in) or swish (clean)',
      'Points banked (0 on a miss). Distance-scaled, see shared/scoring.ts.',
      'Rims made - 2 is a tier-3 double shot through both rims',
      'Hoop tier at resolution time (1-3)',
      'Daily throws the player had left AFTER this one. Blank if they left mid-flight.',
    ],
  },
  progression: {
    headers: ['ts', 'lobby', 'pid', 'event', 'tier', 'players'],
    notes: [
      'Event time, ISO 8601 UTC',
      'Lobby id',
      'Player who triggered it',
      'tier_unlock, upgrade_rejected_threshold (usually a stale server build!), upgrade_rejected_proximity, or score_reset (?reset link)',
      'The tier: reached (tier_unlock) or current (others)',
      'Connected players at that moment',
    ],
  },
  growth: {
    headers: ['ts', 'lobby', 'pid', 'event'],
    notes: [
      'Event time, ISO 8601 UTC',
      'Lobby id (for invite_generated: the freshly minted lobby)',
      'Player id. Empty on client beacons (share_clicked, invite_generated).',
      'THE FUNNEL: invite_generated -> invite_opened (fresh profile joined a lobby = link converted + name confirmed) -> first_throw (that profile\'s first ever throw). Plus share_clicked (SHARE button pressed).',
    ],
  },
  features: {
    headers: ['ts', 'lobby', 'pid', 'feature', 'action', 'value'],
    notes: [
      'Event time, ISO 8601 UTC',
      'Lobby id',
      'Player id',
      'catch, orb, jukebox or chat',
      'done (catch), teleport (orb), play/off (jukebox), msg (chat)',
      'Song index for jukebox play; message LENGTH for chat (content never leaves the game); else empty',
    ],
  },
  ops: {
    headers: ['ts', 'lobby', 'pid', 'event', 'detail'],
    notes: [
      'Event time, ISO 8601 UTC',
      'Lobby id (empty for server-wide events)',
      'Player id (empty for server-wide events)',
      'server_boot (a cold start - on the render free tier this maps spin-downs) or join_rejected_full',
      'Extra context, e.g. port=10000',
    ],
  },
};

/** Run ONCE by hand: mints every tab with a bold, frozen, NOTED header. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const name in SHEETS) {
    const def = SHEETS[name];
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, def.headers.length)
      .setValues([def.headers])
      .setNotes([def.notes])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('bad json');
  }
  if (body.secret !== SECRET) return ContentService.createTextOutput('nope');

  // group by tab so each gets ONE ranged write
  const bySheet = {};
  for (const ev of body.events || []) {
    if (!SHEETS[ev.sheet] || !Array.isArray(ev.row)) continue;
    (bySheet[ev.sheet] = bySheet[ev.sheet] || []).push(ev.row);
  }

  // serialize concurrent batches - two servers (or a redeploy overlap)
  // must not interleave getLastRow/setValues
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    for (const name in bySheet) {
      const sh = ss.getSheetByName(name);
      if (!sh) continue; // setup() not run - drop rather than error
      const width = SHEETS[name].headers.length;
      const rows = bySheet[name].map(function (r) {
        const p = r.slice(0, width);
        while (p.length < width) p.push('');
        return p;
      });
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);
    }
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput('ok');
}
```

## A `daily` dashboard tab (optional, no code)

Add a tab named `daily` by hand and drive it with formulas, e.g.:

- DAU: `=SUMPRODUCT((INT(SPLIT(...)) ... )` - or simpler, one pivot
  table over `sessions` (Insert > Pivot table, rows = date of `ts`,
  values = COUNTUNIQUE of `pid`).
- Make %: pivot over `throws`, values = COUNTA filtered by outcome.

Pivots recompute themselves; the game never writes to this tab.

## Server-side reference

- `server/analytics.ts` - the queue/batch/flush machinery + the
  `track()` singleton (no-op until `initAnalytics()` finds
  `ANALYTICS_URL`). Tested in `server/analytics.test.ts`.
- Hook sites: `server/room.ts` (sessions, throws, progression, growth,
  features), `server/index.ts` (boot), `server/web.ts` (`POST /a`
  beacons, allowlisted by `CLIENT_EVENTS`).
- Client: `src/analytics.ts` `reportEvent()` - sendBeacon to `/a`,
  called from `share.ts` and `settings.ts`.

## Limitations, on purpose

- Dev is untracked: vite has no `/a`, and `ANALYTICS_URL` is unset.
- A dropped batch (network, quota) is gone - no retry, no disk queue.
- `invite_generated` beacons from OFFLINE play carry the minted lobby
  id but an empty pid (no WS identity yet) - the funnel still links
  via the lobby id when the friend opens it.
- Apps Script consumer quota is ~20k URL fetches/day; batching keeps
  the server far under it. If the game ever outgrows Sheets, the swap
  point is `Analytics.flush()`.
