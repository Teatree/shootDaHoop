import { copyText } from "./settings";
import { buildLobbyUrl, shortLobbyTag } from "./shared/lobbyLink";
import { rollLine, type RollResult } from "./shared/shareRoll";

// The SHARE button (owner ask 2026-07-16): sits top-center of the game
// section, where the score display used to live. It collects the local
// player's throw results this session and pressing it copies a
// structured blurb to the clipboard (share v3, owner ask same day):
//
//   # shootDaHoop #123
//   🏀: ✅✅🟥🟥✅ **+200pts** 🔥🔥
//   https://…/?lobby=mossy-fox-3f2a&need=450&hoop=3
//
// The `# ` title and the `**bold**` points are LITERAL Discord-flavored
// markdown, exactly as the owner spec'd them - chats that render
// markdown show a heading and bold text, the rest show the raw marks.
// #123 is shortLobbyTag(lobby); the middle line is shared/shareRoll.ts;
// the need/hoop params carry the court's progress AT SHARE TIME into
// the link preview (shared/shareMeta.ts).
//
// It appears ONLY when the player is all out of balls: green, popping
// in and then pulsating on an interval - a gentle "your run is over,
// brag about it" reminder. Getting balls back hides it again.

const LABEL = "🏀 SHARE";

export interface ShareTracker {
  /** One of the local player's throws resolved: hit or miss, and the
   *  points it banked (0 on a miss). Caught balls are never noted -
   *  CourtScene holds a miss back while it is still catchable. */
  noteResult(made: boolean, points: number): void;
  /** The throw budget hit zero (show the button) or refilled (hide it). */
  setOutOfBalls(out: boolean): void;
  /** Court progress for the link preview: score still needed and the
   *  hoop it unlocks (null at the top tier / offline). */
  setWorldProgress(needed: number | null, nextHoop: number | null): void;
}

/** Wire the button. Call once at boot; works offline too. */
export function initShare(lobby: string | null): ShareTracker {
  const btn = document.querySelector<HTMLButtonElement>("#share-btn");
  if (!btn) return { noteResult() {}, setOutOfBalls() {}, setWorldProgress() {} };
  const results: RollResult[] = [];
  let shown = false;
  let progress: { needed: number; nextHoop: number } | null = null;

  btn.addEventListener("click", () => {
    btn.blur(); // Space/Enter must go back to the game, not re-share
    const title = lobby
      ? `# shootDaHoop #${shortLobbyTag(lobby)}`
      : "# shootDaHoop";
    // progress rides in the URL so the preview shows the court AS SHARED
    const url = lobby
      ? buildLobbyUrl(
          location.origin,
          location.pathname,
          location.search,
          lobby,
          progress
            ? { need: String(progress.needed), hoop: String(progress.nextHoop) }
            : undefined,
        )
      : location.origin + location.pathname;
    void copyText(`${title}\n${rollLine(results)}\n${url}`).then((ok) => {
      btn.textContent = ok ? "Copied!" : "Copy failed";
      setTimeout(() => (btn.textContent = LABEL), 1500);
    });
  });

  return {
    noteResult(made: boolean, points: number) {
      results.push({ made, points });
    },
    setOutOfBalls(out: boolean) {
      if (out === shown) return;
      shown = out;
      btn.hidden = !out;
      if (out) {
        // re-trigger the pop (and the pulse that follows it) on reveal
        btn.classList.remove("appear");
        void btn.offsetWidth;
        btn.classList.add("appear");
      }
    },
    setWorldProgress(needed: number | null, nextHoop: number | null) {
      progress =
        needed !== null && nextHoop !== null ? { needed, nextHoop } : null;
    },
  };
}
