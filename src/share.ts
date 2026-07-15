import { copyText } from "./settings";
import { buildLobbyUrl } from "./shared/lobbyLink";

// The SHARE button (owner ask 2026-07-16): sits top-center of the game
// section, where the score display used to live. It collects the local
// player's throw results this session as an emoji roll - 🏀 for a hit,
// ✖ for a miss - and pressing it copies a shareable blurb to the
// clipboard: "This is how I did: <roll>" plus the link to the lobby the
// game is happening in (the plain court URL when playing offline).
//
// It appears ONLY when the player is all out of balls (owner, same
// day): green, popping in and then pulsating on an interval - a gentle
// "your run is over, brag about it" reminder. Getting balls back (a new
// day / another lobby) hides it again.

const LABEL = "🏀 SHARE";
/** PLACEHOLDER (tune): the roll shows the NEWEST results, capped so a
 *  long session doesn't produce a screen-wide emoji wall. */
const MAX_ROLL = 25;

export interface ShareTracker {
  /** One of the local player's throws resolved: true = hit, false = miss. */
  noteResult(made: boolean): void;
  /** The throw budget hit zero (show the button) or refilled (hide it). */
  setOutOfBalls(out: boolean): void;
}

/** Wire the button. Call once at boot; works offline too. */
export function initShare(lobby: string | null): ShareTracker {
  const btn = document.querySelector<HTMLButtonElement>("#share-btn");
  if (!btn) return { noteResult() {}, setOutOfBalls() {} };
  const results: boolean[] = [];
  let shown = false;
  const url = lobby
    ? buildLobbyUrl(location.origin, location.pathname, location.search, lobby)
    : location.origin + location.pathname;

  btn.addEventListener("click", () => {
    btn.blur(); // Space/Enter must go back to the game, not re-share
    const roll = results
      .slice(-MAX_ROLL)
      .map((made) => (made ? "🏀" : "✖"))
      .join("");
    void copyText(`This is how I did: ${roll}\n${url}`).then((ok) => {
      btn.textContent = ok ? "Copied!" : "Copy failed";
      setTimeout(() => (btn.textContent = LABEL), 1500);
    });
  });

  return {
    noteResult(made: boolean) {
      results.push(made);
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
  };
}
