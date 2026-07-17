// The client's side of analytics: a fire-and-forget beacon to the game
// server's POST /a (server/web.ts), used ONLY for the two moments the
// server can't see itself - the SHARE button press and an invite being
// minted. Everything else (joins, throws, upgrades…) is tracked
// server-side where the events already flow (docs/analytics.md).
//
// In dev vite serves the page and has no /a route - the beacon 404s
// into the void, which is exactly right: dev sessions stay untracked.

/** The allowlist lives server-side (analytics.ts CLIENT_EVENTS). */
export type ClientAnalyticsEvent = "share_clicked" | "invite_generated";

export function reportEvent(
  event: ClientAnalyticsEvent,
  lobby: string | null,
): void {
  const body = JSON.stringify({ event, lobby: lobby ?? "" });
  try {
    // sendBeacon survives tab closes; the fetch fallback keeps old
    // browsers working. Failures are silent by design.
    if (!navigator.sendBeacon?.("a", body)) {
      void fetch("a", { method: "POST", body, keepalive: true }).catch(
        () => {},
      );
    }
  } catch {
    /* analytics never breaks the game */
  }
}
