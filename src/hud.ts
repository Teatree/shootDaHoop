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
import type { BallLookId } from "./shared/tierChanges";

export type LogType = "throw" | "chat" | "presence" | "world";

const FILTER_STORE = "shootDaHoop.logFilters";

// checkbox id → the feed class that hides that category
const FILTERS = [
  { box: "filter-miss", hide: "hide-miss", key: "miss" },
  { box: "filter-presence", hide: "hide-presence", key: "presence" },
] as const;

export interface HUD {
  /**
   * The authoritative rack (energy regen, owner redesign 2026-07-17):
   * n balls, plus the epoch-ms deadline of the next regen (null at the
   * cap). Renders the TARGET state immediately - the recharging slot
   * wears an hourglass + countdown - then pops gained balls in,
   * staggered. `popFrom` overrides the pop baseline (the AFK-return
   * case, where the last SEEN count comes from localStorage).
   */
  setBudget(n: number, nextBallAtMs: number | null, popFrom?: number): void;
  /** the tier's ball look on the UI icons; splash = play the upgrade pop */
  setBallLook(look: BallLookId, splash: boolean): void;
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

  // the ball row is minted from the cap - ONE source of truth
  const slotsBox = el<HTMLDivElement>("ball-slots");
  const hintEl = el<HTMLButtonElement>("ball-hint");
  const hintTip = el<HTMLSpanElement>("ball-hint-tip");
  const slots: HTMLDivElement[] = [];
  for (let i = 0; i < BALANCE.budget.ballCap; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    // the .slot-timer carries the recharging slot's m:ss countdown
    slot.innerHTML = '<div class="ball"></div><div class="slot-timer"></div>';
    slotsBox.insertBefore(slot, hintEl); // the hint stays LAST
    slots.push(slot);
  }

  // mobile wording (docs/mobile.md) - the chat itself lives at the
  // bottom of the wall on every platform now (index.html)
  if (isMobileDevice()) chatEl.placeholder = "Tap to chat";

  // ── the regen display (owner redesign 2026-07-17): slots show the
  //    TARGET count instantly; the first empty slot wears an hourglass
  //    with a countdown recomputed from a DEADLINE each tick (hidden
  //    tabs throttle intervals - a decrementing counter would lag);
  //    gained balls pop in as pure cosmetics. The blue ? hint appears
  //    only at zero balls. ───────────────────────────────────────────
  let displayed = 0; //               balls currently shown filled
  let deadlineMs: number | null = null;
  let popTimers: number[] = [];

  const fmtLeft = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const tickCountdown = () => {
    if (deadlineMs === null) return;
    const left = deadlineMs - Date.now();
    const timer = slots[displayed]?.querySelector(".slot-timer");
    if (timer) timer.textContent = fmtLeft(left);
    hintTip.textContent =
      `Out of balls! Your next one lands in ${fmtLeft(left)}. ` +
      `One ball regrows every ${BALANCE.budget.regenMinutes} minutes, ` +
      `up to ${BALANCE.budget.ballCap} - and they keep growing while ` +
      `you're away.`;
  };
  window.setInterval(tickCountdown, 1000);

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
    setBudget(n: number, nextBallAtMs: number | null, popFrom?: number) {
      const from = Math.max(0, Math.min(popFrom ?? displayed, n));
      deadlineMs = nextBallAtMs;
      slots.forEach((slot, i) => {
        slot.classList.toggle("used", i >= n);
        slot.classList.toggle(
          "recharging",
          nextBallAtMs !== null && i === n,
        );
      });
      // pops are pure cosmetics catching the display up to the target -
      // an authoritative update mid-stagger cancels and re-targets
      for (const t of popTimers) clearTimeout(t);
      popTimers = [];
      for (let i = from; i < n; i++) {
        const idx = i;
        popTimers.push(
          window.setTimeout(() => {
            const s = slots[idx];
            if (!s) return;
            s.classList.remove("pop");
            void s.offsetWidth; // retrigger
            s.classList.add("pop");
          }, (i - from) * 140),
        );
      }
      displayed = n;
      // the blue ? only while out of balls
      hintEl.hidden = n > 0;
      if (n > 0) hintEl.classList.remove("open");
      tickCountdown();
    },

    setBallLook(look: BallLookId, splash: boolean) {
      const box = el<HTMLDivElement>("ball-slots");
      // one CSS class per non-classic look (style.css filter chains)
      box.classList.toggle("red", look === "red");
      box.classList.toggle("pinkpurple", look === "pinkpurple");
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
 * A giphy link's gif id, or null. Page links (giphy.com/gifs/slug-ID),
 * bare ids and media URLs (media.giphy.com/media/.../ID/giphy.gif) all
 * resolve; ONLY the [a-zA-Z0-9] id ever reaches an img src, so the raw
 * URL can't smuggle anything.
 */
function giphyId(url: string): string | null {
  const m = url.match(
    /^https?:\/\/(?:[\w-]+\.)?giphy\.com\/(?:gifs|media|embed|clips|stickers)\/(?:[^\s<]*?-)?([a-zA-Z0-9]{8,})(?:[/?#][^\s<]*)?$/,
  );
  return m ? m[1] : null;
}

/**
 * Turn bare URLs in ALREADY-ESCAPED text into clickable links that open
 * in a new tab (owner 2026-07-16: links shared in chat are interactable).
 * Giphy links render as the ANIMATED GIF itself (owner 2026-07-18),
 * still wrapped in the anchor. Run esc() first - this only trusts the
 * URL match itself, and `<` was escaped away so a URL can't smuggle
 * markup.
 */
export function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const gif = giphyId(url);
    const body = gif
      ? `<img class="chat-gif" src="https://media.giphy.com/media/${gif}/giphy.gif" alt="GIF" loading="lazy">`
      : url;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${body}</a>`;
  });
}
