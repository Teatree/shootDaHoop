import { copyText } from "./settings";
import { buildLobbyUrl } from "./shared/lobbyLink";

// The SHARE button (owner ask 2026-07-16): sits top-center of the game
// section, where the score display used to live. It collects the local
// player's throw results this session as an emoji roll - 🏀 for a hit,
// ✖ for a miss - and pressing it copies a shareable blurb to the
// clipboard: "This is how I did: <roll>" plus the link to the lobby the
// game is happening in (the plain court URL when playing offline).
//
// The button stays hidden until the player's first throw resolves - an
// empty roll isn't much of a brag.

const LABEL = "🏀 SHARE";
/** PLACEHOLDER (tune): the roll shows the NEWEST results, capped so a
 *  long session doesn't produce a screen-wide emoji wall. */
const MAX_ROLL = 25;

export interface ShareTracker {
  /** One of the local player's throws resolved: true = hit, false = miss. */
  noteResult(made: boolean): void;
}

/** Wire the button. Call once at boot; works offline too. */
export function initShare(lobby: string | null): ShareTracker {
  const btn = document.querySelector<HTMLButtonElement>("#share-btn");
  if (!btn) return { noteResult() {} };
  const results: boolean[] = [];
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
      btn.hidden = false; // appears with the first result
    },
  };
}
