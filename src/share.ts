import { reportEvent } from "./analytics";
import { copyText } from "./settings";
import { buildLobbyUrl, ctaLink, shortLobbyTag } from "./shared/lobbyLink";
import { rollLine } from "./shared/shareRoll";

// The SHARE button (share v5, owner redesign 2026-07-17): appears after
// the FIRST HIT of the share-day and stays up. Pressing it copies:
//
//   # shootDaHoop #123
//   🏀🏀🏀 **+345pts**
//   [Come Shoot Some Hoop!](https://…/?lobby=mossy-fox-3f2a&need=450&hoop=3)
//
// Hits only - misses stay off the brag sheet (shared/shareRoll.ts).
// The share-day flips at 8:00AM PLAYER-LOCAL (a fresh morning = a
// fresh roll); the day's roll persists per lobby in localStorage so a
// reload inside the day keeps its hits. The `# ` title, `**bold**`
// and `[named](link)` are literal Discord-flavored markdown.

const LABEL = "🏀 SHARE";

interface DayRoll {
  day: string;
  hits: number;
  pts: number;
}

/** The share-day key: the local date, shifted back 8 hours - so the
 *  day flips at 8:00am wherever the player is. */
export function shareDay(now = new Date()): string {
  const d = new Date(now.getTime() - 8 * 3_600_000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadRoll(key: string): DayRoll {
  try {
    const r = JSON.parse(localStorage.getItem(key) ?? "") as DayRoll;
    if (
      r.day === shareDay() &&
      Number.isFinite(r.hits) &&
      Number.isFinite(r.pts)
    )
      return r;
  } catch {
    /* absent/corrupt/yesterday -> fresh day */
  }
  return { day: shareDay(), hits: 0, pts: 0 };
}

export interface ShareTracker {
  /** One of the local player's throws resolved. Only hits roll; caught
   *  balls never arrive here as misses (they never were misses). */
  noteResult(made: boolean, points: number): void;
  /** Court progress for the link preview: score still needed and the
   *  hoop it unlocks (null at the top tier / offline). */
  setWorldProgress(needed: number | null, nextHoop: number | null): void;
}

/** Wire the button. Call once at boot; works offline too. */
export function initShare(lobby: string | null): ShareTracker {
  const btn = document.querySelector<HTMLButtonElement>("#share-btn");
  if (!btn) return { noteResult() {}, setWorldProgress() {} };
  const store = `shootDaHoop.share.${lobby ?? "offline"}`;
  let roll = loadRoll(store);
  let progress: { needed: number; nextHoop: number } | null = null;

  const save = () => localStorage.setItem(store, JSON.stringify(roll));

  const reveal = () => {
    if (!btn.hidden) return;
    btn.hidden = false;
    // re-trigger the pop (and the pulse that follows it) on reveal
    btn.classList.remove("appear");
    void btn.offsetWidth;
    btn.classList.add("appear");
  };

  /** 8:00am passed (possibly with the tab open): fresh roll, hidden
   *  button - deadline-recomputed, so throttled tabs still flip. */
  const syncDay = () => {
    if (roll.day === shareDay()) return;
    roll = { day: shareDay(), hits: 0, pts: 0 };
    save();
    btn.hidden = true;
    btn.classList.remove("appear");
  };
  window.setInterval(syncDay, 30_000);

  // a reload inside the share-day: the persisted hits re-reveal it
  if (roll.hits > 0) reveal();

  btn.addEventListener("click", () => {
    btn.blur(); // Space/Enter must go back to the game, not re-share
    syncDay();
    reportEvent("share_clicked", lobby);
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
    const blurb = `${title}\n${rollLine(roll.hits, roll.pts)}\n${ctaLink(url)}`;
    void copyText(blurb).then((ok) => {
      btn.textContent = ok ? "Copied!" : "Copy failed";
      setTimeout(() => (btn.textContent = LABEL), 1500);
    });
  });

  return {
    noteResult(made: boolean, points: number) {
      syncDay();
      if (!made) return; // hits only - the wall keeps the honest record
      roll.hits += 1;
      roll.pts += points;
      save();
      reveal(); // the first hit of the day is the button's cue
    },
    setWorldProgress(needed: number | null, nextHoop: number | null) {
      progress =
        needed !== null && nextHoop !== null ? { needed, nextHoop } : null;
    },
  };
}
