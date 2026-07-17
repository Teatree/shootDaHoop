// DOM-side HUD: the court-wall log (right 30%) and the MMORPG chat
// input (bottom-center). The score lives IN the world - on the hoop's
// foot screen (placeholders.ts) - not up here.
//
// Log event types:
//   'throw'    - shot outcomes (distance, miss/hit/swish, points)
//   'chat'     - player chat lines (styled more prominently)
//   'presence' - connection events: join / leave / errors / rejections
//   'world'    - shared-world moments: score resets, tier unlocks
//
// The wall header has a filter dropdown. Only two categories can be
// hidden - misses ('throw' lines carrying the 'miss' class) and
// connection events ('presence') - everything else always shows.
// Hiding is pure CSS (a class on the feed), so it applies retroactively
// and lines keep arriving underneath while filtered out.

import { BALANCE } from "./shared/config";
import { isMobileDevice } from "./mobile";

export type LogType = "throw" | "chat" | "presence" | "world";

const FILTER_STORE = "shootDaHoop.logFilters";

// checkbox id → the feed class that hides that category
const FILTERS = [
  { box: "filter-miss", hide: "hide-miss", key: "miss" },
  { box: "filter-presence", hide: "hide-presence", key: "presence" },
] as const;

export interface HUD {
  /** dim ball slots beyond the server's remaining daily throw budget;
   *  at zero the refill countdown covers the row (UTC-midnight reset) */
  setThrowsRemaining(n: number): void;
  /** the countdown hit zero with the tab open - the budget is fresh */
  onBallsReset(cb: () => void): void;
  /** the tier's ball look on the UI icons; splash = play the upgrade pop */
  setBallLook(red: boolean, splash: boolean): void;
  /** text may contain the placeholders handled below; kept plain-text safe. */
  log(
    type: LogType,
    html: string,
    extraClass?: string,
    onClick?: () => void,
  ): void;
  onChat(cb: (msg: string) => void): void;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

// A small, friendly palette - DOM log and Phaser bubbles both render these.
const EMOJIS = [
  "😀", "😂", "😅", "😊", "😉", "😍", "😎", "🤔",
  "😴", "😭", "😡", "🥳", "🙃", "😬", "🤯", "😤",
  "👍", "👎", "👏", "🙏", "💪", "🤝", "👋", "✌️",
  "🔥", "⭐", "✨", "🎉", "❤️", "💀", "🏀", "🎯",
];

export function initHUD(): HUD {
  const feedEl = el<HTMLDivElement>("log-feed");
  const chatEl = el<HTMLInputElement>("chat-input");
  const sendEl = el<HTMLButtonElement>("chat-send");
  const emojiBtn = el<HTMLButtonElement>("emoji-btn");
  const emojiPop = el<HTMLDivElement>("emoji-pop");

  let chatCb: (msg: string) => void = () => {};

  // the ball row is minted from the daily budget - ONE source of truth
  // (owner 2026-07-17: the budget doubled to 10; hardcoded slots drift)
  const slotsBox = el<HTMLDivElement>("ball-slots");
  for (let i = 0; i < BALANCE.budget.throwsPerDay; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML = '<div class="ball"></div>';
    // the timer cover and the hint stay LAST in the container
    slotsBox.insertBefore(slot, el("ball-timer"));
  }

  // mobile wording (docs/mobile.md) - the chat itself lives at the
  // bottom of the wall on every platform now (index.html)
  if (isMobileDevice()) chatEl.placeholder = "Tap to chat";

  // ── out-of-balls countdown (owner ask 2026-07-16): the balls refill at
  //    UTC MIDNIGHT (shared/budget.ts) whether or not they were spent,
  //    but the timer only shows once ALL of them are. A DOM interval, not
  //    the Phaser clock - it must keep counting in a hidden tab. ────────
  const timerEl = el<HTMLDivElement>("ball-timer");
  // the blue ? beside the row (owner ask 2026-07-17): exists ONLY while
  // out of balls; hovering it explains when the balls come back
  const hintEl = el<HTMLButtonElement>("ball-hint");
  const hintTip = el<HTMLSpanElement>("ball-hint-tip");
  let timerId: number | null = null;
  let ballsResetCb: () => void = () => {};

  const stopTimer = () => {
    if (timerId !== null) clearInterval(timerId);
    timerId = null;
    timerEl.hidden = true;
    hintEl.hidden = true;
    hintEl.classList.remove("open");
  };

  // no hover on a touchscreen: the hint opens on TAP and closes on the
  // next tap (or any tap elsewhere) - desktop keeps the CSS hover
  if (isMobileDevice()) {
    hintEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      hintEl.classList.toggle("open");
    });
    window.addEventListener("pointerdown", (ev) => {
      if (!hintEl.contains(ev.target as Node)) hintEl.classList.remove("open");
    });
  }

  const startTimer = () => {
    if (timerId !== null) return; // already counting
    const now = new Date();
    const target = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );
    const tick = () => {
      const leftS = Math.ceil((target - Date.now()) / 1000);
      if (leftS <= 0) {
        // midnight passed with the tab open - fresh balls, no reload
        stopTimer();
        ballsResetCb();
        return;
      }
      // "1d 12h 22m 3s" (owner format 2026-07-17); the day only appears
      // when it's nonzero - the UTC-midnight reset is always under 24h
      const d = Math.floor(leftS / 86400);
      const h = Math.floor((leftS % 86400) / 3600);
      const m = Math.floor((leftS % 3600) / 60);
      const s = leftS % 60;
      timerEl.textContent = `${d > 0 ? `${d}d ` : ""}${h}h ${m}m ${s}s`;
      // the hint tooltip tells the same story in words, minute-coarse
      hintTip.textContent =
        `You're out of balls for now! A fresh set of ` +
        `${BALANCE.budget.throwsPerDay} arrives in ` +
        `${d > 0 ? `${d}d ` : ""}${h}h ${m}m. Until then you can chat, ` +
        `cheer your friends on, and watch the court wall.`;
    };
    tick();
    timerEl.hidden = false;
    hintEl.hidden = false;
    timerId = window.setInterval(tick, 1000);
  };

  const sendMsg = () => {
    const msg = chatEl.value.trim();
    chatEl.value = "";
    chatEl.blur();
    emojiPop.hidden = true;
    if (msg) chatCb(msg);
  };

  // ── emoji picker ───────────────────────────────────────────────────
  for (const e of EMOJIS) {
    const span = document.createElement("span");
    span.textContent = e;
    span.addEventListener("mousedown", (ev) => {
      ev.preventDefault(); // keep focus in the input
      const at = chatEl.selectionStart ?? chatEl.value.length;
      chatEl.value = chatEl.value.slice(0, at) + e + chatEl.value.slice(at);
      chatEl.focus();
      chatEl.setSelectionRange(at + e.length, at + e.length);
      emojiPop.hidden = true; // picked one → close, like the chat apps do
    });
    emojiPop.appendChild(span);
  }
  emojiBtn.addEventListener("mousedown", (ev) => {
    ev.preventDefault(); // don't steal focus from the input
    emojiPop.hidden = !emojiPop.hidden;
    if (!emojiPop.hidden) chatEl.focus();
  });

  sendEl.addEventListener("click", sendMsg);

  // ── log filter dropdown ────────────────────────────────────────────
  const filterBtn = el<HTMLButtonElement>("log-filter-btn");
  const filterPop = el<HTMLDivElement>("log-filter-pop");

  // shown-state per category - both HIDDEN by default for a fresh
  // player (owner 2026-07-16: the two ticks start off); a saved choice
  // (below) overrides
  let shown: Record<string, boolean> = { miss: false, presence: false };
  try {
    shown = { ...shown, ...JSON.parse(localStorage.getItem(FILTER_STORE) ?? "{}") };
  } catch {
    /* corrupt store → defaults */
  }
  for (const f of FILTERS) {
    const box = el<HTMLInputElement>(f.box);
    box.checked = shown[f.key] !== false;
    feedEl.classList.toggle(f.hide, !box.checked);
    box.addEventListener("change", () => {
      shown[f.key] = box.checked;
      feedEl.classList.toggle(f.hide, !box.checked);
      localStorage.setItem(FILTER_STORE, JSON.stringify(shown));
    });
  }
  filterBtn.addEventListener("click", () => {
    filterPop.hidden = !filterPop.hidden;
  });
  window.addEventListener("mousedown", (ev) => {
    const t = ev.target as Node;
    if (!filterPop.hidden && !filterPop.contains(t) && t !== filterBtn)
      filterPop.hidden = true;
  });

  // Enter (anywhere) focuses chat; Enter (in chat) sends; Esc blurs.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (document.activeElement !== chatEl) {
        chatEl.focus();
        e.preventDefault();
      } else {
        sendMsg();
        e.preventDefault();
      }
    } else if (e.key === "Escape" && document.activeElement === chatEl) {
      chatEl.blur();
      emojiPop.hidden = true;
    }
  });

  return {
    setThrowsRemaining(n: number) {
      const slots = document.querySelectorAll("#ball-slots .slot");
      slots.forEach((slot, i) => slot.classList.toggle("used", i >= n));
      if (n <= 0) startTimer();
      else stopTimer();
    },

    onBallsReset(cb) {
      ballsResetCb = cb;
    },

    setBallLook(red: boolean, splash: boolean) {
      const box = el<HTMLDivElement>("ball-slots");
      box.classList.toggle("red", red);
      if (splash) {
        box.classList.remove("splash");
        void box.offsetWidth; // retrigger the animation
        box.classList.add("splash");
      }
    },

    log(type: LogType, html: string, extraClass?: string, onClick?: () => void) {
      const line = document.createElement("div");
      line.className = `log-line ${type}${extraClass ? ` ${extraClass}` : ""}`;
      line.innerHTML = html;
      if (onClick) {
        line.classList.add("clickable");
        line.addEventListener("click", onClick);
      }
      feedEl.appendChild(line);
      feedEl.scrollTop = feedEl.scrollHeight;
    },

    onChat(cb) {
      chatCb = cb;
    },
  };
}

/** Escape user-typed text before it goes into innerHTML. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Turn bare URLs in ALREADY-ESCAPED text into clickable links that open
 * in a new tab (owner 2026-07-16: links shared in chat are interactable).
 * Run esc() first - this only trusts the URL match itself, and `<` was
 * escaped away so a URL can't smuggle markup.
 */
export function linkify(escaped: string): string {
  return escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
  );
}
