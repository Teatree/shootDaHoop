import { BALANCE } from "./config";

// The share blurb's middle line (share v3, owner ask 2026-07-16):
// emoji roll + banked points + fire flair. Dependency-free of the DOM
// so vitest can pin the fire rules; share.ts renders it verbatim.

/** One resolved throw as the roll sees it (caught balls never arrive). */
export interface RollResult {
  made: boolean;
  points: number;
}

/** PLACEHOLDER (tune): the roll shows the NEWEST results, capped so a
 *  long session doesn't produce a screen-wide emoji wall. */
export const MAX_ROLL = 25;

/** 🔥 #2: total points vs closest-place points for the same hit count. */
export const HOT_HAND_MULT = 1.5;

/**
 * "🏀: ✅ ✅ 🟥 🟥 ✅ **+200pts** 🔥🔥" - the `**` is literal Discord
 * markdown, per the owner's spec; the squares are spaced out for
 * readability (owner ask 2026-07-17). Fires (max 2, owner-confirmed):
 *   🔥 every throw this session hit, at least the full daily 5
 *   🔥 2+ hits and total points >= HOT_HAND_MULT x what the same hits
 *      would have scored from the closest possible spot (insidePts each)
 */
export function rollLine(results: RollResult[]): string {
  const roll = results
    .slice(-MAX_ROLL)
    .map((r) => (r.made ? "✅" : "🟥"))
    .join(" ");
  const hits = results.filter((r) => r.made).length;
  const pts = results.reduce((sum, r) => sum + r.points, 0);
  let fires = "";
  if (results.length >= BALANCE.budget.throwsPerDay && hits === results.length)
    fires += "🔥";
  if (hits >= 2 && pts >= HOT_HAND_MULT * hits * BALANCE.score.insidePts)
    fires += "🔥";
  return `🏀: ${roll} **+${pts}pts**${fires ? ` ${fires}` : ""}`;
}
