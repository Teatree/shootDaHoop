// DOM-side HUD: the court-wall log (right 30%) and the MMORPG chat
// input (bottom-center). The score lives IN the world — on the hoop's
// foot screen (placeholders.ts) — not up here.
//
// Log event types:
//   'throw'    — shot outcomes (distance, miss/hit/swish, points)
//   'chat'     — player chat lines (styled more prominently)
//   'presence' — connection events: join / leave / errors / rejections
//   'world'    — shared-world moments: score resets, tier unlocks
//
// The wall header has a filter dropdown. Only two categories can be
// hidden — misses ('throw' lines carrying the 'miss' class) and
// connection events ('presence') — everything else always shows.
// Hiding is pure CSS (a class on the feed), so it applies retroactively
// and lines keep arriving underneath while filtered out.

export type LogType = "throw" | "chat" | "presence" | "world";

const FILTER_STORE = "shootDaHoop.logFilters";

// checkbox id → the feed class that hides that category
const FILTERS = [
  { box: "filter-miss", hide: "hide-miss", key: "miss" },
  { box: "filter-presence", hide: "hide-presence", key: "presence" },
] as const;

export interface HUD {
  /** dim ball slots beyond the server's remaining daily throw budget */
  setThrowsRemaining(n: number): void;
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

// A small, friendly palette — DOM log and Phaser bubbles both render these.
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

  // shown-state per category, everything visible by default
  let shown: Record<string, boolean> = { miss: true, presence: true };
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
