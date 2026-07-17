// Product analytics -> Google Sheets, through a Google Apps Script web
// app (docs/analytics.md walks through the whole Google side, script
// included). The SERVER is the only emitter: every meaningful player
// action already flows through it, the shared secret never reaches the
// client bundle, and ad blockers never see a beacon. The two client-only
// moments (share pressed, invite minted) arrive as a tiny POST /a that
// web.ts forwards here.
//
// Fire-and-forget by design: events queue in memory and flush in
// batches; a lost batch is lost analytics, never lost gameplay.
// Disabled - a silent no-op - unless ANALYTICS_URL is set, so dev runs
// and tests stay quiet.

/** One tab per event family; the Apps Script setup() mints these. */
export type SheetName =
  | "sessions"
  | "throws"
  | "progression"
  | "growth"
  | "features"
  | "ops";

export type Cell = string | number;

/** Client-reported growth moments POST /a may deliver - everything else
 *  on that endpoint is dropped (never trust the client). */
export const CLIENT_EVENTS = new Set(["share_clicked", "invite_generated"]);

export interface AnalyticsOpts {
  url: string;
  secret: string;
  /** how long a queued event may wait before a flush (default 30 s) */
  flushMs?: number;
  /** queue length that triggers an immediate flush (default 50) */
  maxBatch?: number;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

interface QueuedEvent {
  sheet: SheetName;
  row: Cell[];
}

export class Analytics {
  private queue: QueuedEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly flushMs: number;
  private readonly maxBatch: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly opts: AnalyticsOpts) {
    this.flushMs = opts.flushMs ?? 30_000;
    this.maxBatch = opts.maxBatch ?? 50;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? (() => new Date());
  }

  /** Queue one row. Every row leads with [ts, lobby, pid] so the tabs
   *  stay cross-referenceable; the rest is the tab's own columns. */
  track(sheet: SheetName, lobby: string, pid: string, ...fields: Cell[]) {
    this.queue.push({
      sheet,
      row: [this.now().toISOString(), lobby, pid, ...fields],
    });
    if (this.queue.length >= this.maxBatch) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushMs);
      this.timer.unref?.(); // never hold the process open for analytics
    }
  }

  /** Ship the queue. A failed POST drops the batch with a log line -
   *  analytics must never retry itself into a gameplay problem. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const events = this.queue;
    this.queue = [];
    try {
      // text/plain: Apps Script hands any content type to doPost; the
      // 302 it answers with is Google fetching the response body, the
      // POST itself was already processed
      await this.fetchFn(this.opts.url, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ secret: this.opts.secret, events }),
      });
    } catch (err) {
      console.error(`analytics flush failed (${events.length} rows dropped):`, err);
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

// ── the module singleton the server hooks call ────────────────────────

let active: Analytics | null = null;

/** Reads ANALYTICS_URL / ANALYTICS_SECRET; absent URL = analytics off. */
export function initAnalytics(
  env: Record<string, string | undefined> = process.env,
): Analytics | null {
  active = env.ANALYTICS_URL
    ? new Analytics({ url: env.ANALYTICS_URL, secret: env.ANALYTICS_SECRET ?? "" })
    : null;
  return active;
}

/** No-op unless initAnalytics found a URL - call sites stay unconditional. */
export function track(
  sheet: SheetName,
  lobby: string,
  pid: string,
  ...fields: Cell[]
) {
  active?.track(sheet, lobby, pid, ...fields);
}
