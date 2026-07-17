// The share blurb's middle line (share v5, owner redesign 2026-07-17):
// HITS ONLY - one 🏀 per made basket, capped at MAX_SHOWN and then a
// literal "..." (a wall of balls stops bragging and starts scrolling),
// plus the banked points in Discord-bold. Misses never render: the
// blurb celebrates, the court wall keeps the honest record.
// Dependency-free so both the UI and vitest can import it.

export const MAX_SHOWN = 5;

export function rollLine(hits: number, pts: number): string {
  const balls = "🏀".repeat(Math.min(Math.max(0, hits), MAX_SHOWN));
  const more = hits > MAX_SHOWN ? "..." : "";
  return `${balls}${more} **+${pts}pts**`;
}
