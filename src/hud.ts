// DOM-side HUD: score (top-center), the court-wall log (right 30%),
// and the MMORPG chat input (bottom-center).
//
// Log event types — all three are styled and ready for multiplayer,
// but in this prototype only local throws + your own chat will fire:
//   'throw'    — shot outcomes (distance, miss/hit/swish, points)
//   'chat'     — player chat lines (styled more prominently)
//   'presence' — join / leave / idle

export type LogType = "throw" | "chat" | "presence";

export interface HUD {
  setScore(n: number): void;
  /** dim ball slots beyond the server's remaining daily throw budget */
  setThrowsRemaining(n: number): void;
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
  const scoreEl = el<HTMLDivElement>("score");
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

    setScore(n: number) {
      scoreEl.textContent = String(n);
      scoreEl.classList.remove("bump");
      // retrigger the pop animation
      void scoreEl.offsetWidth;
      scoreEl.classList.add("bump");
      setTimeout(() => scoreEl.classList.remove("bump"), 120);
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
